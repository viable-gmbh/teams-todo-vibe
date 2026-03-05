import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { TaskPriority } from '../../common/task-analysis';
import { SettingsService } from '../../settings/settings.service';

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export interface ChatMessageForAi {
  authorName: string;
  sentAt: string;
  content: string;
  isSelf: boolean;
}

export interface ChatPayloadForAi {
  chatId: string;
  participants: string[];
  selfUserName: string;
  messages: ChatMessageForAi[];
}

export interface ExtractedChatTask {
  taskText: string;
  priority: TaskPriority;
  due: string | null;
  assignee: string | null;
  sourceHint: string;
  contextSummary?: string;
}

export interface ChatTaskExtractionResult {
  tasks: ExtractedChatTask[];
  skippedAsExisting: number;
}

export interface ReactionTaskCandidateInput {
  chatId: string;
  participants: string[];
  selfUserName: string;
  targetMessage: ChatMessageForAi;
  contextMessages: ChatMessageForAi[];
  embeddedMessage?: ChatMessageForAi | null;
}

interface ReactionTaskResponse {
  task: {
    taskText: string;
    priority: 'p1' | 'p2' | 'p3' | 'p4';
    due: string | null;
    assignee: string | null;
    sourceHint: string;
    contextSummary: string;
  };
}

@Injectable()
export class OpenAiService {
  constructor(private readonly settingsService: SettingsService) {}

  async analyzeChatForTasks(
    chat: ChatPayloadForAi,
    existingTodoistTasks: string[],
  ): Promise<ChatTaskExtractionResult> {
    const apiKey = await this.settingsService.getOpenAiApiKey();
    if (!apiKey) {
      return { tasks: [], skippedAsExisting: 0 };
    }

    const selfName = (chat.selfUserName || 'Unknown').trim() || 'Unknown';

    const prompt = [
      'Extract todo items from this Teams chat.',
      'Use full context, with higher weight on recent messages.',
      'The user is represented by messages where isSelf=true.',
      `The user's name is "${selfName}".`,
      '',
      `Chat ID: ${chat.chatId}`,
      `Participants: ${chat.participants.join(', ') || '[Unknown]'}`,
      '',
      'Messages (JSON):',
      JSON.stringify(chat.messages),
      '',
      'Existing Todoist task titles (JSON):',
      JSON.stringify(existingTodoistTasks),
      '',
      'Rules:',
      '- Favor clearly actionable items.',
      '- Prefer tasks that are relevant to the user.',
      '- taskText must be concise and in English.',
      '- priority defaults to p4 unless urgency is explicit.',
      '- due is null unless explicitly present.',
      '- assignee is null unless explicitly present.',
      '- sourceHint should briefly reference why this task was extracted.',
    ].join('\n');

    const response = await axios.post<OpenAiChatCompletionResponse>(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'chat_tasks',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                tasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      taskText: { type: 'string' },
                      priority: {
                        type: 'string',
                        enum: ['p1', 'p2', 'p3', 'p4'],
                      },
                      due: { type: ['string', 'null'] },
                      assignee: { type: ['string', 'null'] },
                      sourceHint: { type: 'string' },
                    },
                    required: [
                      'taskText',
                      'priority',
                      'due',
                      'assignee',
                      'sourceHint',
                    ],
                    additionalProperties: false,
                  },
                },
                skippedAsExisting: { type: 'number' },
              },
              required: ['tasks', 'skippedAsExisting'],
              additionalProperties: false,
            },
          },
        },
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
      },
    );

    const rawText = response.data?.choices?.[0]?.message?.content ?? '{}';
    try {
      const parsed = JSON.parse(rawText) as Partial<ChatTaskExtractionResult>;
      const tasks = (parsed.tasks ?? [])
        .map((task) => ({
          taskText: (task.taskText ?? '').trim(),
          priority: this.normalizePriority(task.priority),
          due: this.normalizeNullable(task.due),
          assignee: this.normalizeNullable(task.assignee),
          sourceHint: this.normalizeNullable(task.sourceHint) ?? '',
        }))
        .filter((task) => task.taskText.length >= 4);
      return {
        tasks,
        skippedAsExisting: Math.max(0, Number(parsed.skippedAsExisting ?? 0)),
      };
    } catch {
      return { tasks: [], skippedAsExisting: 0 };
    }
  }

  async analyzeReactionCandidateForTask(
    candidate: ReactionTaskCandidateInput,
    existingTodoistTasks: string[],
  ): Promise<ExtractedChatTask | null> {
    const apiKey = await this.settingsService.getOpenAiApiKey();
    if (!apiKey) {
      return null;
    }

    const selfName = (candidate.selfUserName || 'Unknown').trim() || 'Unknown';

    const prompt = [
      'Convert exactly one Teams message marked by a reaction emoji into a TODO item for the user.',
      'Always return one task object.',
      'Do not reject, filter, or judge whether it is actionable.',
      'If wording is unclear, still produce the best concise todo interpretation.',
      'Extract as much task context as possible from nearby messages and embed it into taskText/sourceHint.',
      `The user's name is "${selfName}".`,
      '',
      `Chat ID: ${candidate.chatId}`,
      `Participants: ${candidate.participants.join(', ') || '[Unknown]'}`,
      '',
      'Target reacted message (JSON):',
      JSON.stringify(candidate.targetMessage),
      '',
      'Context messages around the target (JSON):',
      JSON.stringify(candidate.contextMessages),
      '',
      'Embedded/replied message referenced by target (JSON or null):',
      JSON.stringify(candidate.embeddedMessage ?? null),
      '',
      'Existing Todoist task titles (JSON):',
      JSON.stringify(existingTodoistTasks),
      '',
      'Rules:',
      '- Always output one task object for the reacted message.',
      '- taskText must be concise and in English.',
      '- taskText must be self-contained and specific even without opening the chat log.',
      '- Include key entities and scope in taskText when present (project/team/system/person/deliverable).',
      '- Preserve concrete constraints in taskText when present (version, date, environment, location).',
      '- priority defaults to p4 unless urgency is explicit.',
      '- due is null unless explicitly present.',
      '- assignee is null unless explicitly present.',
      '- sourceHint should include why it is needed and important context/dependencies from surrounding messages.',
      '- contextSummary must be one concise sentence in third person, for example: "Maria asked Kai to change meeting X from weekly to monthly at month-end due to low engagement."',
      '- If the messages include image references, include the key visual detail in contextSummary.',
      '',
      'Return JSON with this shape:',
      '{"task":{"taskText":"string","priority":"p1|p2|p3|p4","due":"string|null","assignee":"string|null","sourceHint":"string","contextSummary":"string"}}',
    ].join('\n');

    const response = await axios.post<OpenAiChatCompletionResponse>(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'reaction_task',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                task: {
                  type: 'object',
                  properties: {
                    taskText: { type: 'string' },
                    priority: {
                      type: 'string',
                      enum: ['p1', 'p2', 'p3', 'p4'],
                    },
                    due: { type: ['string', 'null'] },
                    assignee: { type: ['string', 'null'] },
                    sourceHint: { type: 'string' },
                    contextSummary: { type: 'string' },
                  },
                  required: [
                    'taskText',
                    'priority',
                    'due',
                    'assignee',
                    'sourceHint',
                    'contextSummary',
                  ],
                  additionalProperties: false,
                },
              },
              required: ['task'],
              additionalProperties: false,
            },
          },
        },
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
      },
    );

    const rawText = response.data?.choices?.[0]?.message?.content ?? '{}';
    try {
      const parsed = JSON.parse(rawText) as Partial<ReactionTaskResponse>;
      const task = parsed.task;
      if (!task) {
        return this.buildFallbackTask(candidate);
      }
      const normalized = {
        taskText: (task.taskText ?? '').trim(),
        priority: this.normalizePriority(task.priority),
        due: this.normalizeNullable(task.due),
        assignee: this.normalizeNullable(task.assignee),
        sourceHint:
          this.normalizeNullable(task.sourceHint) ??
          'Generated from reacted Teams message.',
        contextSummary:
          this.normalizeNullable(task.contextSummary) ??
          'A teammate asked the user to complete the task captured from the reacted message.',
      };
      if (normalized.taskText.length >= 4) {
        return normalized;
      }
      return this.buildFallbackTask(candidate);
    } catch {
      return this.buildFallbackTask(candidate);
    }
  }

  private normalizePriority(value: unknown): TaskPriority {
    if (value === 'p1' || value === 'p2' || value === 'p3' || value === 'p4') {
      return value;
    }
    return 'p4';
  }

  private normalizeNullable(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private buildFallbackTask(
    candidate: ReactionTaskCandidateInput,
  ): ExtractedChatTask {
    const sourceText =
      candidate.embeddedMessage?.content ||
      candidate.targetMessage.content ||
      candidate.contextMessages[candidate.contextMessages.length - 1]
        ?.content ||
      '';
    const compact = sourceText.replace(/\s+/g, ' ').trim().slice(0, 200);
    const author = candidate.targetMessage.authorName?.trim() || 'teammate';
    return {
      taskText:
        compact.length > 0
          ? `Follow up with ${author}: ${compact}`
          : `Follow up on reacted Teams message from ${author}`,
      priority: 'p4',
      due: null,
      assignee: null,
      sourceHint:
        'Generated from reacted Teams message with surrounding chat context.',
      contextSummary: `A teammate asked the user to handle this item based on the reacted message: ${compact.length > 0 ? compact : 'follow up required'}.`,
    };
  }
}
