import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MessagesService } from './messages.service';

@Injectable()
export class MessagesScheduler {
  private readonly logger = new Logger(MessagesScheduler.name);

  constructor(private readonly messagesService: MessagesService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async enqueuePeriodicReactionSync(): Promise<void> {
    try {
      const { chatLimit, messageLimit } = this.messagesService.getPollingConfig();
      const result = await this.messagesService.enqueueLatestChats(chatLimit, messageLimit);
      this.logger.log(
        `Queued reaction sync for ${result.chatsQueued} chats (messageLimit=${result.messageLimit})`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue periodic reaction sync: ${(error as Error).message}`,
      );
    }
  }
}
