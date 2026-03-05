import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CompletionNotifierModule } from '../completion-notifier/completion-notifier.module';

@Module({
  imports: [PrismaModule, IntegrationsModule, CompletionNotifierModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
