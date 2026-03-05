import { BadRequestException, Injectable } from '@nestjs/common';
import { TaskSourceType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GraphService } from '../integrations/graph/graph.service';
import { CompletionNotifierService } from '../completion-notifier/completion-notifier.service';

export interface ChatMessageLog {
  chatId: string;
  chatName: string;
  status: 'QUEUED' | 'ANALYZING' | 'TASKS_FOUND' | 'NO_TASKS';
  latestMessageAt: string | null;
  lastAnalyzedAt: string | null;
  messagesAnalyzed: number;
  tasksFound: number;
}

export interface FlushAnalyzingChatsSummary {
  flushed: number;
}

export interface TaskListItem {
  id: string;
  text: string;
  description: string | null;
  sortOrder: number;
  priority: string;
  due: string | null;
  assignee: string | null;
  done: boolean;
  sourceType: 'AUTO_DETECTED' | 'CUSTOM';
  autoReplyEnabled: boolean;
  sourceMessageText: string | null;
  sourceLanguage: string | null;
  completionNotifiedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface TaskListQuery {
  done?: string;
  sourceType?: string;
}

export interface CreateTaskInput {
  text: string;
  description?: string | null;
  priority?: string;
  due?: string | null;
  assignee?: string | null;
}

export interface UpdateTaskInput {
  text?: string;
  description?: string | null;
  priority?: string;
  due?: string | null;
  assignee?: string | null;
  autoReplyEnabled?: boolean;
}

export interface SetTaskDoneInput {
  done: boolean;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly graphService: GraphService,
    private readonly completionNotifierService: CompletionNotifierService,
  ) {}

  async listTasks(query: TaskListQuery): Promise<TaskListItem[]> {
    const doneFilter = this.parseOptionalBoolean(query.done);
    const sourceFilter = this.parseSourceType(query.sourceType);
    const tasks = await this.prismaService.task.findMany({
      where: {
        ...(doneFilter === null ? {} : { done: doneFilter }),
        ...(sourceFilter ? { sourceType: sourceFilter } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return tasks.map((task) => ({
      id: task.id,
      text: task.text,
      description: task.description ?? null,
      sortOrder: task.sortOrder,
      priority: task.priority,
      due: task.due ?? null,
      assignee: task.assignee ?? null,
      done: task.done,
      sourceType: task.sourceType,
      autoReplyEnabled: task.autoReplyEnabled,
      sourceMessageText: task.sourceMessageText ?? null,
      sourceLanguage: task.sourceLanguage ?? null,
      completionNotifiedAt: task.completionNotifiedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
    }));
  }

  async createCustomTask(input: CreateTaskInput): Promise<TaskListItem> {
    const text = input.text?.trim() ?? '';
    if (text.length < 3) {
      throw new BadRequestException('Task text must be at least 3 characters long.');
    }
    const nextSortOrder = await this.resolveNextSortOrder();
    const task = await this.prismaService.task.create({
      data: {
        text,
        description: this.normalizeNullableString(input.description),
        sortOrder: nextSortOrder,
        priority: this.normalizePriority(input.priority),
        due: this.normalizeNullableString(input.due),
        assignee: this.normalizeNullableString(input.assignee),
        source: 'Created manually',
        sourceType: TaskSourceType.CUSTOM,
        autoReplyEnabled: false,
        chatId: 'custom',
        graphMessageId: `custom:${randomUUID()}`,
        fromSelf: true,
        done: false,
      },
    });
    return {
      id: task.id,
      text: task.text,
      description: task.description ?? null,
      sortOrder: task.sortOrder,
      priority: task.priority,
      due: task.due ?? null,
      assignee: task.assignee ?? null,
      done: task.done,
      sourceType: task.sourceType,
      autoReplyEnabled: task.autoReplyEnabled,
      sourceMessageText: task.sourceMessageText ?? null,
      sourceLanguage: task.sourceLanguage ?? null,
      completionNotifiedAt: task.completionNotifiedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
    };
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<TaskListItem> {
    if (input.text !== undefined && input.text.trim().length < 3) {
      throw new BadRequestException('Task text must be at least 3 characters long.');
    }
    const existing = await this.prismaService.task.findUnique({ where: { id: taskId } });
    if (!existing) {
      throw new BadRequestException('Task not found.');
    }
    const task = await this.prismaService.task.update({
      where: { id: taskId },
      data: {
        ...(input.text !== undefined ? { text: input.text.trim() } : {}),
        ...(input.description !== undefined
          ? { description: this.normalizeNullableString(input.description) }
          : {}),
        ...(input.priority !== undefined ? { priority: this.normalizePriority(input.priority) } : {}),
        ...(input.due !== undefined ? { due: this.normalizeNullableString(input.due) } : {}),
        ...(input.assignee !== undefined ? { assignee: this.normalizeNullableString(input.assignee) } : {}),
        ...(existing.sourceType === TaskSourceType.AUTO_DETECTED &&
        input.autoReplyEnabled !== undefined
          ? { autoReplyEnabled: Boolean(input.autoReplyEnabled) }
          : existing.sourceType === TaskSourceType.CUSTOM
            ? { autoReplyEnabled: false }
            : {}),
      },
    });
    return {
      id: task.id,
      text: task.text,
      description: task.description ?? null,
      sortOrder: task.sortOrder,
      priority: task.priority,
      due: task.due ?? null,
      assignee: task.assignee ?? null,
      done: task.done,
      sourceType: task.sourceType,
      autoReplyEnabled: task.autoReplyEnabled,
      sourceMessageText: task.sourceMessageText ?? null,
      sourceLanguage: task.sourceLanguage ?? null,
      completionNotifiedAt: task.completionNotifiedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
    };
  }

  async setTaskDone(taskId: string, input: SetTaskDoneInput): Promise<TaskListItem> {
    const done = Boolean(input.done);
    const updated = await this.prismaService.task.update({
      where: { id: taskId },
      data: done
        ? { done: true, completedAt: new Date() }
        : { done: false, completedAt: null, completionNotifiedAt: null },
    });
    if (done) {
      await this.completionNotifierService.pollAndNotifyCompletions();
    }
    return {
      id: updated.id,
      text: updated.text,
      description: updated.description ?? null,
      sortOrder: updated.sortOrder,
      priority: updated.priority,
      due: updated.due ?? null,
      assignee: updated.assignee ?? null,
      done: updated.done,
      sourceType: updated.sourceType,
      autoReplyEnabled: updated.autoReplyEnabled,
      sourceMessageText: updated.sourceMessageText ?? null,
      sourceLanguage: updated.sourceLanguage ?? null,
      completionNotifiedAt: updated.completionNotifiedAt?.toISOString() ?? null,
      completedAt: updated.completedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async deleteTask(taskId: string): Promise<{ deleted: boolean }> {
    await this.prismaService.task.delete({ where: { id: taskId } });
    return { deleted: true };
  }

  async reorderTasks(taskIds: string[]): Promise<{ reordered: number }> {
    const ids = taskIds.filter((id) => id.trim().length > 0);
    if (ids.length === 0) {
      throw new BadRequestException('taskIds must not be empty.');
    }
    await Promise.all(
      ids.map((taskId, index) =>
        this.prismaService.task.update({
          where: { id: taskId },
          data: { sortOrder: index + 1 },
        }),
      ),
    );
    return { reordered: ids.length };
  }

  async incomingMessageChats(): Promise<ChatMessageLog[]> {
    const states = await this.prismaService.chatAnalysisState.findMany({
      where: { lastAnalyzedAt: { not: null } },
      orderBy: [{ lastAnalyzedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });
    if (states.length === 0) {
      return [];
    }

    const me = await this.graphService.getCurrentUser();
    const result = await Promise.all(
      states.map(async (state) => ({
        chatId: state.chatId,
        chatName: await this.resolveChatName(state.chatId, me.id),
        status: state.status,
        latestMessageAt: state.latestMessageAt?.toISOString() ?? null,
        lastAnalyzedAt: state.lastAnalyzedAt?.toISOString() ?? null,
        messagesAnalyzed: state.messagesAnalyzed,
        tasksFound: state.tasksFound,
      })),
    );
    return result;
  }

  async flushAnalyzingChats(): Promise<FlushAnalyzingChatsSummary> {
    const result = await this.prismaService.chatAnalysisState.updateMany({
      where: { status: 'ANALYZING' },
      data: {
        status: 'NO_TASKS',
        lastAnalyzedAt: new Date(),
      },
    });
    return { flushed: result.count };
  }

  private async resolveChatName(chatId: string, myUserId: string): Promise<string> {
    try {
      const chat = await this.graphService.getChat(chatId);
      const topic = chat?.topic?.trim();
      if (topic) {
        return topic;
      }

      const members = await this.graphService.listChatMembers(chatId);
      if (members.length === 0) {
        return chatId;
      }

      const others = members.filter((member) => member.id !== myUserId);
      if (chat?.chatType === 'oneOnOne' || others.length === 1) {
        const counterpart = others[0] ?? members[0];
        return counterpart?.displayName?.trim() || counterpart?.email?.trim() || chatId;
      }

      const names = others
        .map((member) => member.displayName?.trim() || member.email?.trim() || '')
        .filter((name) => name.length > 0);
      if (names.length === 0) {
        return chatId;
      }
      if (names.length <= 3) {
        return names.join(', ');
      }
      return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
    } catch {
      return chatId;
    }
  }

  private normalizePriority(input?: string): string {
    const value = (input ?? 'p4').trim().toLowerCase();
    if (value === 'p1' || value === 'p2' || value === 'p3' || value === 'p4') {
      return value;
    }
    return 'p4';
  }

  private normalizeNullableString(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseOptionalBoolean(value?: string): boolean | null {
    if (value === undefined) {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    return null;
  }

  private parseSourceType(value?: string): TaskSourceType | null {
    if (!value) {
      return null;
    }
    const normalized = value.trim().toUpperCase();
    if (normalized === 'AUTO_DETECTED') {
      return TaskSourceType.AUTO_DETECTED;
    }
    if (normalized === 'CUSTOM') {
      return TaskSourceType.CUSTOM;
    }
    return null;
  }

  private async resolveNextSortOrder(): Promise<number> {
    const current = await this.prismaService.task.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (current?.sortOrder ?? 0) + 1;
  }
}
