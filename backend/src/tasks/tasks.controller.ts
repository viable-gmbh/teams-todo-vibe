import { Controller, Get, Post } from '@nestjs/common';
import { FlushAnalyzingChatsSummary, TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('message-chats')
  incomingMessageChats() {
    return this.tasksService.incomingMessageChats();
  }

  @Post('message-chats/flush')
  flushAnalyzingChats(): Promise<FlushAnalyzingChatsSummary> {
    return this.tasksService.flushAnalyzingChats();
  }
}
