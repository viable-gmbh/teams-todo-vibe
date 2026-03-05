import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GraphService } from '../integrations/graph/graph.service';

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

@Injectable()
export class TasksService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly graphService: GraphService,
  ) {}

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
}
