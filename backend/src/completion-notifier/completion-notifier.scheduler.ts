import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CompletionNotifierService } from './completion-notifier.service';

@Injectable()
export class CompletionNotifierScheduler {
  private readonly logger = new Logger(CompletionNotifierScheduler.name);

  constructor(private readonly completionNotifierService: CompletionNotifierService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    try {
      await this.completionNotifierService.pollAndNotifyCompletionsForAllUsers();
    } catch (error) {
      this.logger.warn(`Completion notifier run failed: ${(error as Error).message}`);
    }
  }
}
