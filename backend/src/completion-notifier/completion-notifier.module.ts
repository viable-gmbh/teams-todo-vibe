import { Module } from '@nestjs/common';
import { CompletionNotifierService } from './completion-notifier.service';
import { CompletionNotifierScheduler } from './completion-notifier.scheduler';
import { CompletionNotifierController } from './completion-notifier.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [PrismaModule, IntegrationsModule],
  controllers: [CompletionNotifierController],
  providers: [CompletionNotifierService, CompletionNotifierScheduler],
  exports: [CompletionNotifierService],
})
export class CompletionNotifierModule {}
