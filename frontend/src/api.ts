import axios from 'axios';

export interface IncomingMessageChat {
  chatId: string;
  chatName: string;
  status: 'QUEUED' | 'ANALYZING' | 'TASKS_FOUND' | 'NO_TASKS';
  latestMessageAt: string | null;
  lastAnalyzedAt: string | null;
  messagesAnalyzed: number;
  tasksFound: number;
}

export interface SettingsResponse {
  openaiApiKeyHint: string | null;
  reactionEmoji: string;
  completionReplyDe: string;
  completionReplyEn: string;
}

export interface SyncMessagesResponse {
  chatsQueued: number;
  messageLimit: number;
}

export interface FlushAnalyzingChatsResponse {
  flushed: number;
}

export interface InternalTask {
  id: string;
  text: string;
  description: string | null;
  sortOrder: number;
  priority: 'p1' | 'p2' | 'p3' | 'p4';
  due: string | null;
  assignee: string | null;
  done: boolean;
  sourceType: 'AUTO_DETECTED' | 'CUSTOM';
  autoReplyEnabled: boolean;
  sourceMessageText: string | null;
  sourceLanguage: string | null;
  completionNotifiedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  withCredentials: true,
});

export const endpoints = {
  authStatus: () => api.get<{ authenticated: boolean; expiresAt: string | null }>('/auth/status'),
  incomingMessageChats: () => api.get<IncomingMessageChat[]>('/tasks/message-chats'),
  tasks: (params?: { done?: boolean; sourceType?: 'AUTO_DETECTED' | 'CUSTOM' }) => {
    const query = new URLSearchParams();
    if (params?.done !== undefined) {
      query.set('done', String(params.done));
    }
    if (params?.sourceType) {
      query.set('sourceType', params.sourceType);
    }
    const suffix = query.toString();
    return api.get<InternalTask[]>(`/tasks${suffix ? `?${suffix}` : ''}`);
  },
  createTask: (payload: {
    text: string;
    description?: string | null;
    priority?: string;
    due?: string | null;
    assignee?: string | null;
  }) =>
    api.post<InternalTask>('/tasks', payload),
  updateTask: (
    taskId: string,
    payload: {
      text?: string;
      description?: string | null;
      priority?: string;
      due?: string | null;
      assignee?: string | null;
      autoReplyEnabled?: boolean;
    },
  ) => api.patch<InternalTask>(`/tasks/${taskId}`, payload),
  setTaskDone: (taskId: string, done: boolean) =>
    api.post<InternalTask>(`/tasks/${taskId}/done`, { done }),
  deleteTask: (taskId: string) => api.delete<{ deleted: boolean }>(`/tasks/${taskId}`),
  reorderTasks: (taskIds: string[]) => api.post<{ reordered: number }>('/tasks/reorder', { taskIds }),
  settings: () => api.get<SettingsResponse>('/settings'),
  updateSettings: (payload: {
    openaiApiKey?: string;
    reactionEmoji?: string;
    completionReplyDe?: string;
    completionReplyEn?: string;
  }) =>
    api.patch('/settings', payload),
  syncMessages: (chatLimit = 10, messageLimit = 20) =>
    api.post<SyncMessagesResponse>(
      `/messages/sync?chatLimit=${chatLimit}&messageLimit=${messageLimit}`,
    ),
  flushAnalyzingChats: () => api.post<FlushAnalyzingChatsResponse>('/tasks/message-chats/flush'),
};
