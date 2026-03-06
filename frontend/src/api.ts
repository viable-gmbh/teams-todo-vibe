import axios from 'axios';

const TOKEN_KEY = 'teams_todo_auth_token';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore storage failures (private mode, strict browser policies)
  }
}

function clearStoredToken(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage failures
  }
}

function consumeTokenFromUrl(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) {
    return;
  }

  setStoredToken(token);
  params.delete('token');

  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', nextUrl);
}

consumeTokenFromUrl();

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
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearStoredToken();
    }
    return Promise.reject(error);
  },
);

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
