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
  todoistApiKeyHint: string | null;
  openaiApiKeyHint: string | null;
}

export interface SyncMessagesResponse {
  chatsQueued: number;
  messageLimit: number;
}

export interface FlushAnalyzingChatsResponse {
  flushed: number;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  withCredentials: true,
});

export const endpoints = {
  authStatus: () => api.get<{ authenticated: boolean; expiresAt: string | null }>('/auth/status'),
  incomingMessageChats: () => api.get<IncomingMessageChat[]>('/tasks/message-chats'),
  settings: () => api.get<SettingsResponse>('/settings'),
  updateSettings: (payload: { todoistApiKey?: string; openaiApiKey?: string }) =>
    api.patch('/settings', payload),
  syncMessages: (chatLimit = 10, messageLimit = 20) =>
    api.post<SyncMessagesResponse>(
      `/messages/sync?chatLimit=${chatLimit}&messageLimit=${messageLimit}`,
    ),
  flushAnalyzingChats: () => api.post<FlushAnalyzingChatsResponse>('/tasks/message-chats/flush'),
};
