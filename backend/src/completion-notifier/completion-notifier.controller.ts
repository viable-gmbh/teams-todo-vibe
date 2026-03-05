import { Controller, Post } from '@nestjs/common';
import {
  CompletionNotifierService,
  CompletionPollSummary,
} from './completion-notifier.service';

@Controller('completion-notifier')
export class CompletionNotifierController {
  constructor(private readonly completionNotifierService: CompletionNotifierService) {}

  @Post('sync')
  async triggerManualSync(): Promise<CompletionPollSummary> {
    return this.completionNotifierService.pollAndNotifyCompletions();
  }
}
