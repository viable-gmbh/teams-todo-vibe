import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MessagesController } from './messages.controller';
import { MessagesProcessor } from './messages.processor';
import { MessagesScheduler } from './messages.scheduler';
import { MessagesService } from './messages.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'teams-sync' }), PrismaModule, IntegrationsModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesProcessor, MessagesScheduler],
})
export class MessagesModule {}
