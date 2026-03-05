import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
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

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  listTasks(@Query() query: TaskListQueryDto): Promise<TaskListItem[]> {
    return this.tasksService.listTasks(query);
  }

  @Post()
  createCustomTask(@Body() payload: CreateTaskDto): Promise<TaskListItem> {
    return this.tasksService.createCustomTask(payload);
  }

  @Patch(':taskId')
  updateTask(
    @Param('taskId') taskId: string,
    @Body() payload: UpdateTaskDto,
  ): Promise<TaskListItem> {
    return this.tasksService.updateTask(taskId, payload);
  }

  @Post(':taskId/done')
  setTaskDone(
    @Param('taskId') taskId: string,
    @Body() payload: SetTaskDoneDto,
  ): Promise<TaskListItem> {
    return this.tasksService.setTaskDone(taskId, payload);
  }

  @Delete(':taskId')
  deleteTask(@Param('taskId') taskId: string): Promise<{ deleted: boolean }> {
    return this.tasksService.deleteTask(taskId);
  }

  @Post('reorder')
  reorderTasks(@Body() payload: ReorderTasksDto): Promise<{ reordered: number }> {
    return this.tasksService.reorderTasks(payload.taskIds);
  }

  @Get('message-chats')
  incomingMessageChats() {
    return this.tasksService.incomingMessageChats();
  }

  @Post('message-chats/flush')
  flushAnalyzingChats(): Promise<FlushAnalyzingChatsSummary> {
    return this.tasksService.flushAnalyzingChats();
  }
}
