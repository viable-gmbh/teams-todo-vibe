import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  FlushAnalyzingChatsSummary,
  TaskListItem,
  TasksService,
} from './tasks.service';
import {
  CreateTaskDto,
  ReorderTasksDto,
  SetTaskDoneDto,
  TaskListQueryDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@UseGuards(SessionAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  listTasks(@CurrentUserId() userId: string, @Query() query: TaskListQueryDto): Promise<TaskListItem[]> {
    return this.tasksService.listTasks(userId, query);
  }

  @Post()
  createCustomTask(@CurrentUserId() userId: string, @Body() payload: CreateTaskDto): Promise<TaskListItem> {
    return this.tasksService.createCustomTask(userId, payload);
  }

  @Patch(':taskId')
  updateTask(
    @CurrentUserId() userId: string,
    @Param('taskId') taskId: string,
    @Body() payload: UpdateTaskDto,
  ): Promise<TaskListItem> {
    return this.tasksService.updateTask(userId, taskId, payload);
  }

  @Post(':taskId/done')
  setTaskDone(
    @CurrentUserId() userId: string,
    @Param('taskId') taskId: string,
    @Body() payload: SetTaskDoneDto,
  ): Promise<TaskListItem> {
    return this.tasksService.setTaskDone(userId, taskId, payload);
  }

  @Delete(':taskId')
  deleteTask(@CurrentUserId() userId: string, @Param('taskId') taskId: string): Promise<{ deleted: boolean }> {
    return this.tasksService.deleteTask(userId, taskId);
  }

  @Post('reorder')
  reorderTasks(@CurrentUserId() userId: string, @Body() payload: ReorderTasksDto): Promise<{ reordered: number }> {
    return this.tasksService.reorderTasks(userId, payload.taskIds);
  }

  @Get('message-chats')
  incomingMessageChats(@CurrentUserId() userId: string) {
    return this.tasksService.incomingMessageChats(userId);
  }

  @Post('message-chats/flush')
  flushAnalyzingChats(@CurrentUserId() userId: string): Promise<FlushAnalyzingChatsSummary> {
    return this.tasksService.flushAnalyzingChats(userId);
  }
}
