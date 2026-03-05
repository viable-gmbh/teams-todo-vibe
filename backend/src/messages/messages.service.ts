import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChatMessageForAi,
  OpenAiService,
} from '../integrations/openai/openai.service';
import { GraphChatMessage, GraphService } from '../integrations/graph/graph.service';
import { TaskSourceType } from '@prisma/client';

export interface SyncRunSummary {
  chatsScanned: number;
  messagesScanned: number;
  taskCandidates: number;
  createdTasks: number;
  skippedAsExisting: number;
}

export interface ChatSyncJob {
  userId: string;
  chatId: string;
  messageLimit: number;
}

export interface SyncEnqueueSummary {
  chatsQueued: number;
  messageLimit: number;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private readonly defaultReactionEmoji: string;
  private readonly pollChatLimit: number;
  private readonly pollMessageLimit: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly openAiService: OpenAiService,
    private readonly graphService: GraphService,
    @InjectQueue('teams-sync') private readonly syncQueue: Queue,
  ) {
    this.defaultReactionEmoji = (this.configService.get<string>('SYNC_REACTION_EMOJI') ?? 'wrench')
      .trim()
      .toLowerCase();
    this.pollChatLimit = this.readBoundedNumber('SYNC_CHAT_LIMIT', 10, 1, 25);
    this.pollMessageLimit = this.readBoundedNumber('SYNC_MESSAGE_LIMIT', 30, 5, 50);
  }

  getPollingConfig(): { chatLimit: number; messageLimit: number } {
    return {
      chatLimit: this.pollChatLimit,
      messageLimit: this.pollMessageLimit,
    };
  }

  async enqueueLatestChatsForAllUsers(
    chatLimit?: number,
    messageLimit?: number,
  ): Promise<SyncEnqueueSummary> {
    const users = await this.prismaService.user.findMany({ select: { id: true } });
    let chatsQueued = 0;
    let effectiveMessageLimit = Math.min(50, Math.max(1, messageLimit ?? this.pollMessageLimit));
    for (const user of users) {
      const summary = await this.enqueueLatestChats(user.id, chatLimit, messageLimit);
      chatsQueued += summary.chatsQueued;
      effectiveMessageLimit = summary.messageLimit;
    }
    return { chatsQueued, messageLimit: effectiveMessageLimit };
  }

  async enqueueLatestChats(
    userId: string,
    chatLimit?: number,
    messageLimit?: number,
  ): Promise<SyncEnqueueSummary> {
    const safeChatLimit = Math.min(25, Math.max(1, chatLimit ?? this.pollChatLimit));
    const safeMessageLimit = Math.min(50, Math.max(1, messageLimit ?? this.pollMessageLimit));
    const chats = await this.graphService.listChats(userId, safeChatLimit);

    let queued = 0;
    for (const chat of chats) {
      await this.prismaService.chatAnalysisState.upsert({
        where: { userId_chatId: { userId, chatId: chat.id } },
        update: {
          status: 'QUEUED',
          messagesAnalyzed: 0,
          tasksFound: 0,
        },
        create: {
          userId,
          chatId: chat.id,
          status: 'QUEUED',
          messagesAnalyzed: 0,
          tasksFound: 0,
        },
      });
      await this.syncQueue.add(
        'sync-chat',
        { userId, chatId: chat.id, messageLimit: safeMessageLimit },
        {
          attempts: 2,
          removeOnComplete: true,
          jobId: `sync-chat:${chat.id}:${Date.now()}`,
        },
      );
      queued += 1;
    }
    return {
      chatsQueued: queued,
      messageLimit: safeMessageLimit,
    };
  }

  async processChatJob(job: ChatSyncJob): Promise<SyncRunSummary> {
    let analyzedGraphMessageIds: string[] = [];
    try {
      this.logger.log(`Starting chat analysis chatId=${job.chatId} messageLimit=${job.messageLimit}`);
      await this.prismaService.chatAnalysisState.upsert({
        where: { userId_chatId: { userId: job.userId, chatId: job.chatId } },
        update: { status: 'ANALYZING' },
        create: { userId: job.userId, chatId: job.chatId, status: 'ANALYZING' },
      });

      let me: Awaited<ReturnType<GraphService['getCurrentUser']>>;
      try {
        me = await this.graphService.getCurrentUser(job.userId);
      } catch (error) {
        this.logger.error(
          `Failed to load Graph current user chatId=${job.chatId}: ${this.describeError(error)}`,
        );
        throw error;
      }

      const existingTaskTitles = (
        await this.prismaService.task.findMany({
          where: { userId: job.userId, done: false },
          select: { text: true },
        })
      ).map((task) => task.text);
      const configuredReactionEmoji = await this.resolveReactionEmoji(job.userId);
      const chatTitle = await this.resolveChatTitle(job.userId, job.chatId);

      const summary: SyncRunSummary = {
        chatsScanned: 1,
        messagesScanned: 0,
        taskCandidates: 0,
        createdTasks: 0,
        skippedAsExisting: 0,
      };

      let messages: GraphChatMessage[];
      try {
        messages = await this.graphService.listRecentMessages(job.userId, job.chatId, job.messageLimit);
      } catch (error) {
        this.logger.error(
          `Failed to load Graph messages chatId=${job.chatId}: ${this.describeError(error)}`,
        );
        throw error;
      }
      analyzedGraphMessageIds = messages.map((message) => message.id);
      if (messages.length === 0) {
        this.logger.warn(`No recent messages returned chatId=${job.chatId}`);
        await this.prismaService.chatAnalysisState.upsert({
          where: { userId_chatId: { userId: job.userId, chatId: job.chatId } },
          update: {
            status: 'NO_TASKS',
            lastAnalyzedAt: new Date(),
            messagesAnalyzed: 0,
            tasksFound: 0,
            latestMessageAt: null,
          },
          create: {
            userId: job.userId,
            chatId: job.chatId,
            status: 'NO_TASKS',
            lastAnalyzedAt: new Date(),
            messagesAnalyzed: 0,
            tasksFound: 0,
            latestMessageAt: null,
          },
        });
        return summary;
      }

      summary.messagesScanned = messages.length;
      const latestMessageAt = messages[messages.length - 1]?.createdDateTime
        ? new Date(messages[messages.length - 1].createdDateTime as string)
        : new Date();

      for (const message of messages) {
        await this.prismaService.incomingMessage.upsert({
          where: {
            userId_chatId_graphMessageId: {
              userId: job.userId,
              chatId: job.chatId,
              graphMessageId: message.id,
            },
          },
          update: {
            senderName: message.from?.user?.displayName ?? 'Unknown',
            senderEmail: message.from?.user?.email ?? null,
            messageText: (message.body?.content ?? '').slice(0, 4000),
            teamsMessageAt: message.createdDateTime ? new Date(message.createdDateTime) : null,
            status: 'UNQUEUED',
          },
          create: {
            userId: job.userId,
            graphMessageId: message.id,
            senderName: message.from?.user?.displayName ?? 'Unknown',
            senderEmail: message.from?.user?.email ?? null,
            messageText: (message.body?.content ?? '').slice(0, 4000),
            chatId: job.chatId,
            teamsMessageAt: message.createdDateTime ? new Date(message.createdDateTime) : null,
            status: 'UNQUEUED',
          },
        });
      }

      const reactedMessages = this.findReactionCandidates(messages, me.id, configuredReactionEmoji);

      if (reactedMessages.length === 0) {
        this.logger.warn(
          `No reaction candidates found chatId=${job.chatId} messagesScanned=${messages.length} reaction=${configuredReactionEmoji}`,
        );
        await this.prismaService.chatAnalysisState.upsert({
          where: { userId_chatId: { userId: job.userId, chatId: job.chatId } },
          update: {
            status: 'NO_TASKS',
            lastAnalyzedAt: new Date(),
            messagesAnalyzed: messages.length,
            tasksFound: 0,
            latestMessageAt,
          },
          create: {
            userId: job.userId,
            chatId: job.chatId,
            status: 'NO_TASKS',
            lastAnalyzedAt: new Date(),
            messagesAnalyzed: messages.length,
            tasksFound: 0,
            latestMessageAt,
          },
        });
        return summary;
      }

      let nextSortOrder = await this.resolveNextSortOrder(job.userId);
      for (const candidateMessage of reactedMessages) {
        const targetIndex = messages.findIndex((message) => message.id === candidateMessage.id);
        if (targetIndex < 0) {
          this.logger.warn(
            `Reaction candidate missing from message window chatId=${job.chatId} graphMessageId=${candidateMessage.id}`,
          );
          continue;
        }

        const aiPayload = this.toReactionAiPayload(job.chatId, messages, targetIndex, me);
        try {
          aiPayload.embeddedMessage = await this.resolveEmbeddedMessage(
              job.userId,
            job.chatId,
            candidateMessage,
            messages,
            me,
          );
        } catch (error) {
          this.logger.error(
            `Embedded message resolution failed chatId=${job.chatId} graphMessageId=${candidateMessage.id}: ${
              this.describeError(error)
            }`,
          );
          continue;
        }
        let extraction: Awaited<ReturnType<OpenAiService['analyzeReactionCandidateForTask']>> = null;
        try {
          extraction = await this.openAiService.analyzeReactionCandidateForTask(
            job.userId,
            aiPayload,
            existingTaskTitles,
          );
        } catch (error) {
          this.logger.error(
            `OpenAI analysis failed chatId=${job.chatId} graphMessageId=${candidateMessage.id}: ${
              this.describeError(error)
            }`,
          );
          continue;
        }
        if (!extraction) {
          this.logger.warn(
            `No task extracted for reaction candidate chatId=${job.chatId} graphMessageId=${candidateMessage.id}`,
          );
          continue;
        }

        const taskText = this.formatTaskText(extraction.taskText);
        if (!taskText || this.matchesExistingTask(taskText, existingTaskTitles)) {
          summary.skippedAsExisting += 1;
          continue;
        }
        summary.taskCandidates += 1;
        const source = this.buildTaskContextDescription(aiPayload, extraction, chatTitle);
        const sourceMessageText = this.stripHtml(candidateMessage.body?.content ?? '');
        const sourceLanguage = this.detectSourceLanguage(sourceMessageText);
        try {
          await this.prismaService.task.upsert({
            where: {
              userId_chatId_graphMessageId: {
                userId: job.userId,
                chatId: job.chatId,
                graphMessageId: candidateMessage.id,
              },
            },
            update: {
              text: taskText,
              description: source,
              priority: extraction.priority,
              due: extraction.due,
              assignee: extraction.assignee,
              source,
              sourceType: TaskSourceType.AUTO_DETECTED,
              autoReplyEnabled: true,
              sourceMessageText,
              sourceLanguage,
              fromSelf: this.isSelfMessage(candidateMessage, me),
            },
            create: {
              userId: job.userId,
              text: taskText,
              description: source,
              sortOrder: nextSortOrder,
              priority: extraction.priority,
              due: extraction.due,
              assignee: extraction.assignee,
              source,
              sourceType: TaskSourceType.AUTO_DETECTED,
              autoReplyEnabled: true,
              sourceMessageText,
              sourceLanguage,
              chatId: job.chatId,
              graphMessageId: candidateMessage.id,
              fromSelf: this.isSelfMessage(candidateMessage, me),
              done: false,
            },
          });
          nextSortOrder += 1;
        } catch (error) {
          this.logger.error(
            `Failed to persist task linkage chatId=${job.chatId} graphMessageId=${candidateMessage.id}: ${
              this.describeError(error)
            }`,
          );
        }
        summary.createdTasks += 1;
        existingTaskTitles.push(taskText);
      }

      await this.prismaService.chatAnalysisState.upsert({
        where: { userId_chatId: { userId: job.userId, chatId: job.chatId } },
        update: {
          status: summary.taskCandidates > 0 ? 'TASKS_FOUND' : 'NO_TASKS',
          lastAnalyzedAt: new Date(),
          messagesAnalyzed: messages.length,
          tasksFound: summary.taskCandidates,
          latestMessageAt,
        },
        create: {
          userId: job.userId,
          chatId: job.chatId,
          status: summary.taskCandidates > 0 ? 'TASKS_FOUND' : 'NO_TASKS',
          lastAnalyzedAt: new Date(),
          messagesAnalyzed: messages.length,
          tasksFound: summary.taskCandidates,
          latestMessageAt,
        },
      });
      return summary;
    } catch (error) {
      this.logger.error(
        `Chat analysis failed chatId=${job.chatId}: ${
          this.describeError(error)
        }`,
      );
      try {
        await this.prismaService.chatAnalysisState.upsert({
          where: { userId_chatId: { userId: job.userId, chatId: job.chatId } },
          update: {
            status: 'NO_TASKS',
            lastAnalyzedAt: new Date(),
            tasksFound: 0,
          },
          create: {
            userId: job.userId,
            chatId: job.chatId,
            status: 'NO_TASKS',
            lastAnalyzedAt: new Date(),
            tasksFound: 0,
          },
        });
        this.logger.warn(`Set fallback NO_TASKS status after failure chatId=${job.chatId}`);
      } catch (statusError) {
        this.logger.error(
          `Failed to set fallback status chatId=${job.chatId}: ${
            this.describeError(statusError)
          }`,
        );
      }
      throw error;
    } finally {
      await this.clearAnalyzedMessagesFromLog(job.userId, job.chatId, analyzedGraphMessageIds);
    }
  }

  private formatTaskText(raw: string): string {
    const base = (raw ?? '').trim();
    if (!base) {
      return '';
    }
    return base;
  }

  private toReactionAiPayload(
    chatId: string,
    allMessages: GraphChatMessage[],
    targetIndex: number,
    me: { id: string; mail?: string; userPrincipalName?: string; displayName?: string },
  ): {
    chatId: string;
    participants: string[];
    selfUserName: string;
    targetMessage: ChatMessageForAi;
    contextMessages: ChatMessageForAi[];
    embeddedMessage?: ChatMessageForAi | null;
  } {
    const participants = new Set<string>();
    for (const message of allMessages) {
      const authorName = message.from?.user?.displayName?.trim();
      if (authorName) {
        participants.add(authorName);
      }
    }

    if (me.displayName) {
      participants.add(me.displayName);
    }

    const selfUserName =
      me.displayName?.trim() ||
      me.mail?.trim() ||
      me.userPrincipalName?.trim() ||
      'Unknown';

    const start = Math.max(0, targetIndex - 4);
    const end = Math.min(allMessages.length, targetIndex + 5);
    const contextMessages = allMessages
      .slice(start, end)
      .map((message) => ({
        authorName: message.from?.user?.displayName ?? 'Unknown',
        sentAt: message.createdDateTime ?? new Date().toISOString(),
        content: this.stripHtml(message.body?.content ?? ''),
        isSelf: this.isSelfMessage(message, me),
      }))
      .filter((message) => message.content.length > 0);
    const targetMessage = {
      authorName: allMessages[targetIndex]?.from?.user?.displayName ?? 'Unknown',
      sentAt: allMessages[targetIndex]?.createdDateTime ?? new Date().toISOString(),
      content: this.stripHtml(allMessages[targetIndex]?.body?.content ?? ''),
      isSelf: allMessages[targetIndex] ? this.isSelfMessage(allMessages[targetIndex], me) : false,
    };

    return {
      chatId,
      participants: Array.from(participants),
      selfUserName,
      targetMessage,
      contextMessages,
    };
  }

  private buildTaskContextDescription(
    payload: {
      chatId: string;
      selfUserName: string;
      participants: string[];
      targetMessage: ChatMessageForAi;
      contextMessages: ChatMessageForAi[];
      embeddedMessage?: ChatMessageForAi | null;
    },
    extraction: {
      taskText: string;
      priority: string;
      due: string | null;
      assignee: string | null;
      sourceHint: string;
      contextSummary?: string;
    },
    chatTitle: string,
  ): string {
    const narrative =
      extraction.contextSummary?.trim() ||
      `A teammate asked ${payload.selfUserName} to complete: ${extraction.taskText}.`;
    const markedMessage = `[${payload.targetMessage.sentAt}] ${payload.targetMessage.authorName}: ${payload.targetMessage.content}`;
    const description = [
      narrative,
      `Chat Title: ${chatTitle}`,
      `Marked Message: ${markedMessage}`,
    ].join('\n');
    return description.slice(0, 3500);
  }

  private isSelfMessage(
    message: { from?: { user?: { id?: string; email?: string } } },
    me: { id: string; mail?: string; userPrincipalName?: string },
  ): boolean {
    const sender = message.from?.user;
    if (!sender) {
      return false;
    }
    if (sender.id && sender.id === me.id) {
      return true;
    }
    const senderEmail = sender.email?.toLowerCase();
    const meMail = me.mail?.toLowerCase();
    const meUpn = me.userPrincipalName?.toLowerCase();
    return Boolean(senderEmail && (senderEmail === meMail || senderEmail === meUpn));
  }

  private findReactionCandidates(
    messages: GraphChatMessage[],
    meId: string,
    configuredReactionEmoji: string,
  ): GraphChatMessage[] {
    return messages.filter((message) => this.hasConfiguredReaction(message, meId, configuredReactionEmoji));
  }

  private hasConfiguredReaction(
    message: GraphChatMessage,
    meId: string,
    configuredReactionEmoji: string,
  ): boolean {
    if (!message.reactions || message.reactions.length === 0) {
      return false;
    }
    const targetValues = this.resolveReactionTargets(configuredReactionEmoji);
    return message.reactions.some((reaction) => {
      const reactionType = (reaction.reactionType ?? '').trim().toLowerCase();
      const displayName = (reaction.displayName ?? '').trim().toLowerCase();
      const reactorId = reaction.user?.user?.id;
      const matchedEmoji = targetValues.has(reactionType) || targetValues.has(displayName);
      if (!matchedEmoji) {
        return false;
      }
      if (!meId) {
        return true;
      }
      return !reactorId || reactorId === meId;
    });
  }

  private async resolveEmbeddedMessage(
    userId: string,
    chatId: string,
    targetMessage: GraphChatMessage,
    allMessages: GraphChatMessage[],
    me: { id: string; mail?: string; userPrincipalName?: string; displayName?: string },
  ): Promise<ChatMessageForAi | null> {
    const referencedId = targetMessage.replyToId?.trim();
    if (!referencedId) {
      return null;
    }
    const inWindow = allMessages.find((message) => message.id === referencedId);
    if (inWindow) {
      return this.toAiMessage(inWindow, me);
    }
    const fetched = await this.graphService.getMessage(userId, chatId, referencedId);
    if (!fetched) {
      return null;
    }
    return this.toAiMessage(fetched, me);
  }

  private matchesExistingTask(taskText: string, existingTaskTitles: string[]): boolean {
    const normalized = taskText.trim().toLowerCase();
    return existingTaskTitles.some((title) => title.trim().toLowerCase() === normalized);
  }

  private async clearAnalyzedMessagesFromLog(
    userId: string,
    chatId: string,
    graphMessageIds: string[],
  ): Promise<void> {
    if (graphMessageIds.length === 0) {
      return;
    }
    await this.prismaService.incomingMessage.deleteMany({
      where: {
        userId,
        chatId,
        graphMessageId: { in: graphMessageIds },
      },
    });
  }

  private readBoundedNumber(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = Number(this.configService.get<string>(key) ?? fallback);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  private stripHtml(input: string): string {
    return input
      .replace(
        /<img[^>]*alt="([^"]*)"[^>]*>/gi,
        (_full: string, alt: string) => ` [image: ${alt?.trim() || 'no-alt'}] `,
      )
      .replace(
        /<img[^>]*src="([^"]*)"[^>]*>/gi,
        (_full: string, src: string) => ` [image-url: ${src?.trim() || 'unknown'}] `,
      )
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private toAiMessage(
    message: GraphChatMessage,
    me: { id: string; mail?: string; userPrincipalName?: string; displayName?: string },
  ): ChatMessageForAi {
    return {
      authorName: message.from?.user?.displayName ?? 'Unknown',
      sentAt: message.createdDateTime ?? new Date().toISOString(),
      content: this.stripHtml(message.body?.content ?? ''),
      isSelf: this.isSelfMessage(message, me),
    };
  }

  private compactMessageText(input: string): string {
    const cleaned = this.stripHtml(input);
    if (!cleaned) {
      return '[empty]';
    }
    return cleaned.slice(0, 420);
  }

  private detectSourceLanguage(text: string): string {
    const sample = text.trim().toLowerCase();
    if (!sample) {
      return 'en';
    }
    const germanSignals = [
      ' und ',
      ' bitte ',
      'danke',
      ' erledigt',
      ' aufgabe',
      'nicht',
      ' mit ',
      ' für ',
      'ich ',
      'wir ',
      'kannst',
      'könntest',
    ];
    const score = germanSignals.reduce(
      (sum, token) => (sample.includes(token) ? sum + 1 : sum),
      0,
    );
    return score >= 2 ? 'de' : 'en';
  }

  private async resolveChatTitle(userId: string, chatId: string): Promise<string> {
    try {
      const chat = await this.graphService.getChat(userId, chatId);
      const topic = chat?.topic?.trim();
      if (topic) {
        return topic;
      }
    } catch {
      // Ignore lookup failures and fall back to the ID.
    }
    return chatId;
  }

  private async resolveReactionEmoji(userId: string): Promise<string> {
    const settings = await this.prismaService.settings.findUnique({
      where: { userId },
      select: { reactionEmoji: true },
    });
    return settings?.reactionEmoji?.trim().toLowerCase() || this.defaultReactionEmoji;
  }

  private resolveReactionTargets(configuredValue: string): Set<string> {
    const normalized = configuredValue.trim().toLowerCase();
    const targets = new Set<string>([normalized]);
    const aliases: Record<string, string[]> = {
      thumbsup: ['👍', 'thumbs_up', 'thumbs up', 'like'],
      heart: ['❤️'],
      wrench: ['🔧', '🛠', '🛠️', 'workingonit', 'working_on_it'],
    };
    for (const alias of aliases[normalized] ?? []) {
      targets.add(alias.trim().toLowerCase());
    }
    return targets;
  }

  private describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const method = error.config?.method?.toUpperCase() ?? 'UNKNOWN_METHOD';
      const url = error.config?.url ?? 'UNKNOWN_URL';
      const status = error.response?.status ?? 'NO_STATUS';
      const responseData = error.response?.data;
      let responseSnippet = '';
      if (typeof responseData === 'string') {
        responseSnippet = responseData.slice(0, 280);
      } else if (responseData !== undefined) {
        try {
          responseSnippet = JSON.stringify(responseData).slice(0, 280);
        } catch {
          responseSnippet = '[unserializable response data]';
        }
      }
      return `${error.message} [${method} ${url} status=${status}${responseSnippet ? ` response=${responseSnippet}` : ''}]`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private async resolveNextSortOrder(userId: string): Promise<number> {
    const latest = await this.prismaService.task.findFirst({
      where: { userId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (latest?.sortOrder ?? 0) + 1;
  }
}
