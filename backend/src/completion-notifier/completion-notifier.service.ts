import { Injectable, Logger } from '@nestjs/common';
import { TaskSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GraphService } from '../integrations/graph/graph.service';

export interface CompletionPollSummary {
  since: string;
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  skippedBecauseRunning: boolean;
}

@Injectable()
export class CompletionNotifierService {
  private readonly logger = new Logger(CompletionNotifierService.name);
  private readonly defaultCompletionReplyDe = 'Erledigt.';
  private readonly defaultCompletionReplyEn = 'Done.';
  private running = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly graphService: GraphService,
  ) {}

  async pollAndNotifyCompletions(): Promise<CompletionPollSummary> {
    if (this.running) {
      this.logger.warn('Skipping completion poll because previous run is still active.');
      return {
        since: new Date().toISOString(),
        processed: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        skippedBecauseRunning: true,
      };
    }
    this.running = true;
    try {
      return await this.pollAndNotifyCompletionsInternal();
    } finally {
      this.running = false;
    }
  }

  private async pollAndNotifyCompletionsInternal(): Promise<CompletionPollSummary> {
    const startedAt = new Date();
    const replyMessages = await this.resolveReplyMessages();
    const candidates = await this.prismaService.task.findMany({
      where: {
        done: true,
        completionNotifiedAt: null,
        sourceType: TaskSourceType.AUTO_DETECTED,
        autoReplyEnabled: true,
      },
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const task of candidates) {
      if (!task.chatId || !task.graphMessageId) {
        skipped += 1;
        continue;
      }
      const sourceText = this.compactText(task.sourceMessageText ?? task.text);
      const language = this.detectSourceLanguage(sourceText, task.sourceLanguage ?? undefined);
      const replyBody = this.buildReplyHtml(sourceText, language, replyMessages);
      try {
        await this.graphService.sendReply(task.chatId, task.graphMessageId, replyBody);
        await this.prismaService.task.update({
          where: { id: task.id },
          data: {
            completedAt: task.completedAt ?? new Date(),
            completionNotifiedAt: new Date(),
            sourceLanguage: language,
          },
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Completion reply failed chatId=${task.chatId} graphMessageId=${task.graphMessageId} taskId=${task.id}: ${
            (error as Error).message
          }`,
        );
      }
    }

    this.logger.log(
      `Completion poll processed=${candidates.length} sent=${sent} failed=${failed} skipped=${skipped}`,
    );
    return {
      since: startedAt.toISOString(),
      processed: candidates.length,
      sent,
      failed,
      skipped,
      skippedBecauseRunning: false,
    };
  }

  private detectSourceLanguage(text: string, persisted?: string): string {
    const normalizedPersisted = (persisted ?? '').trim().toLowerCase();
    if (normalizedPersisted === 'de' || normalizedPersisted === 'en') {
      return normalizedPersisted;
    }
    const sample = text.toLowerCase();
    const germanSignals = [
      ' und ',
      ' bitte ',
      ' danke ',
      ' aufgabe',
      ' erledigt',
      ' nicht ',
      ' für ',
      'kannst',
      'könntest',
      'ich ',
      'wir ',
    ];
    const hits = germanSignals.reduce(
      (count, token) => (sample.includes(token) ? count + 1 : count),
      0,
    );
    return hits >= 2 ? 'de' : 'en';
  }

  private buildReplyHtml(
    sourceText: string,
    language: string,
    replyMessages: { de: string; en: string },
  ): string {
    void sourceText;
    const statusText = language === 'de' ? replyMessages.de : replyMessages.en;
    return `<p>${statusText}</p>`;
  }

  private compactText(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return '[task completed]';
    }
    return normalized.slice(0, 600);
  }

  private async resolveReplyMessages(): Promise<{ de: string; en: string }> {
    const settings = await this.prismaService.settings.findFirst({
      select: { completionReplyDe: true, completionReplyEn: true },
    });
    return {
      de: settings?.completionReplyDe?.trim() || this.defaultCompletionReplyDe,
      en: settings?.completionReplyEn?.trim() || this.defaultCompletionReplyEn,
    };
  }

}
