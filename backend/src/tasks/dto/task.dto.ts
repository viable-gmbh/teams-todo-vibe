import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class TaskListQueryDto {
  @IsOptional()
  @IsString()
  done?: string;

  @IsOptional()
  @IsString()
  @IsIn(['AUTO_DETECTED', 'CUSTOM'])
  sourceType?: string;
}

export class CreateTaskDto {
  @IsString()
  @MinLength(3)
  text!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['p1', 'p2', 'p3', 'p4'])
  priority?: string;

  @IsOptional()
  @IsString()
  due?: string | null;

  @IsOptional()
  @IsString()
  assignee?: string | null;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  text?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['p1', 'p2', 'p3', 'p4'])
  priority?: string;

  @IsOptional()
  @IsString()
  due?: string | null;

  @IsOptional()
  @IsString()
  assignee?: string | null;

  @IsOptional()
  @IsBoolean()
  autoReplyEnabled?: boolean;
}

export class SetTaskDoneDto {
  @IsBoolean()
  done!: boolean;
}

export class ReorderTasksDto {
  @IsArray()
  @IsString({ each: true })
  taskIds!: string[];
}
