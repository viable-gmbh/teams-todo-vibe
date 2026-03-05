import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphService } from './graph/graph.service';
import { OpenAiService } from './openai/openai.service';
import { TodoistService } from './todoist/todoist.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ConfigModule, AuthModule, PrismaModule, SettingsModule],
  providers: [GraphService, OpenAiService, TodoistService],
  exports: [GraphService, OpenAiService, TodoistService],
})
export class IntegrationsModule {}
