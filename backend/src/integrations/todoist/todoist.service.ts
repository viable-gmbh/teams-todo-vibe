import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskAnalysisResult } from '../../common/task-analysis';
import { decryptAes256 } from '../../common/crypto.util';
import { randomUUID } from 'crypto';

export interface TodoistTaskSummary {
  id: string;
  content: string;
}

export interface TodoistTaskSnapshot {
  connected: boolean;
  tasks: TodoistTaskSummary[];
}

@Injectable()
export class TodoistService {
  private readonly logger = new Logger(TodoistService.name);
  private readonly restV2TasksEndpoint = 'https://api.todoist.com/rest/v2/tasks';
  private readonly apiV1TasksEndpoint = 'https://api.todoist.com/api/v1/tasks';

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

  private async resolveApiKey(): Promise<string | null> {
    const settings = await this.prismaService.settings.findFirst();
    if (settings?.todoistKeyEnc) {
      const secret = this.configService.get<string>(
        'SESSION_SECRET',
        'dev-session-secret',
      );
      return decryptAes256(settings.todoistKeyEnc, secret);
    }
    return null;
  }

  async listTasks(): Promise<TodoistTaskSnapshot> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      return { connected: false, tasks: [] };
    }

    const preferredEndpoint =
      this.configService.get<string>('TODOIST_TASKS_ENDPOINT') ??
      this.apiV1TasksEndpoint;
    const candidates = [preferredEndpoint, this.restV2TasksEndpoint, this.apiV1TasksEndpoint]
      .filter((endpoint, index, all) => all.indexOf(endpoint) === index);

    for (const endpoint of candidates) {
      try {
        const response = await axios.get<unknown>(endpoint, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        const parsedTasks = this.extractTaskSummaries(response.data);
        return {
          connected: true,
          tasks: parsedTasks,
        };
      } catch (error) {
        const details = axios.isAxiosError(error)
          ? `status=${error.response?.status ?? 'unknown'} message=${error.message}`
          : (error as Error).message;
        this.logger.warn(
          `Todoist task list fetch failed for ${endpoint}: ${details}`,
        );
      }
    }

    return { connected: false, tasks: [] };
  }

  async createTask(
    task: TaskAnalysisResult,
    description?: string,
  ): Promise<string | null> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey || !task.taskText) {
      return null;
    }

    const payload = {
      content: task.taskText,
      description: description?.trim() || undefined,
      due_string: task.due ?? undefined,
      priority: this.mapPriority(task.priority),
    };
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Prevent duplicate creation when retries happen.
      'X-Request-Id': randomUUID(),
    };

    const preferredEndpoint =
      this.configService.get<string>('TODOIST_TASKS_ENDPOINT') ??
      this.apiV1TasksEndpoint;
    const candidates = [preferredEndpoint, this.restV2TasksEndpoint, this.apiV1TasksEndpoint]
      .filter((endpoint, index, all) => all.indexOf(endpoint) === index);

    for (const endpoint of candidates) {
      try {
        const response = await axios.post(endpoint, payload, { headers });
        return response.data?.id ?? null;
      } catch (error) {
        this.logger.warn(
          `Todoist task create failed for ${endpoint}: ${(error as Error).message}`,
        );
      }
    }

    return null;
  }

  private extractTaskSummaries(payload: unknown): TodoistTaskSummary[] {
    const rawItems = this.resolveTaskItems(payload);
    return rawItems
      .map((task) => {
        const id = this.readStringField(task, 'id');
        const content = this.readStringField(task, 'content')?.trim() ?? '';
        return {
          id: id ?? '',
          content,
        };
      })
      .filter((task) => task.id.length > 0 && task.content.length > 0);
  }

  private resolveTaskItems(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) {
      return payload.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    }
    if (typeof payload !== 'object' || payload === null) {
      return [];
    }
    const record = payload as Record<string, unknown>;
    const candidates = [record.results, record.items, record.tasks];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
      }
    }
    return [];
  }

  private readStringField(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    return null;
  }

  private mapPriority(priority: TaskAnalysisResult['priority']): number {
    switch (priority) {
      case 'p1':
        return 4;
      case 'p2':
        return 3;
      case 'p3':
        return 2;
      default:
        return 1;
    }
  }
}
