import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { ChatSyncJob, MessagesService } from './messages.service';

@Processor('teams-sync')
export class MessagesProcessor {
  constructor(private readonly messagesService: MessagesService) {}

  @Process({ name: 'sync-chat', concurrency: 1 })
  async process(job: Job<ChatSyncJob>): Promise<void> {
    await this.messagesService.processChatJob(job.data);
  }
}
