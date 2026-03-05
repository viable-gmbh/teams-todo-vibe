import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { MessagesService, SyncEnqueueSummary } from './messages.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@UseGuards(SessionAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('sync')
  async syncLatestChats(
    @CurrentUserId() userId: string,
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
    return this.messagesService.enqueueLatestChats(userId, parsedChatLimit, parsedMessageLimit);
  }
}
