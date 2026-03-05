import { Controller, Post, UseGuards } from '@nestjs/common';
import {
  CompletionNotifierService,
  CompletionPollSummary,
} from './completion-notifier.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@UseGuards(SessionAuthGuard)
@Controller('completion-notifier')
export class CompletionNotifierController {
  constructor(private readonly completionNotifierService: CompletionNotifierService) {}

  @Post('sync')
  async triggerManualSync(@CurrentUserId() userId: string): Promise<CompletionPollSummary> {
    return this.completionNotifierService.pollAndNotifyCompletions(userId);
  }
}
