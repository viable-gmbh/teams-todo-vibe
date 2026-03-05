import { Controller, Post, Query } from '@nestjs/common';
import { MessagesService, SyncEnqueueSummary } from './messages.service';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('sync')
  async syncLatestChats(
    @Query('chatLimit') chatLimit?: string,
    @Query('messageLimit') messageLimit?: string,
  ): Promise<SyncEnqueueSummary> {
    const parsedChatLimit =
      typeof chatLimit === 'string' && chatLimit.trim().length > 0
        ? Number(chatLimit)
        : undefined;
    const parsedMessageLimit =
      typeof messageLimit === 'string' && messageLimit.trim().length > 0
        ? Number(messageLimit)
        : undefined;
    return this.messagesService.enqueueLatestChats(parsedChatLimit, parsedMessageLimit);
  }
}
