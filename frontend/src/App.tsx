import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { endpoints } from './api';
import type { IncomingMessageChat } from './api';

function chatStatusLabel(status: IncomingMessageChat['status']): string {
  switch (status) {
    case 'QUEUED':
      return 'queued';
    case 'ANALYZING':
      return 'analyzing';
    case 'TASKS_FOUND':
      return 'tasks found';
    case 'NO_TASKS':
      return 'no tasks found';
    default:
      return 'queued';
  }
}

function chatStatusClassName(status: IncomingMessageChat['status']): string {
  switch (status) {
    case 'TASKS_FOUND':
      return 'bg-emerald-100 text-emerald-700';
    case 'NO_TASKS':
      return 'bg-slate-100 text-slate-700';
    case 'ANALYZING':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-blue-100 text-blue-700';
  }
}

function App() {
  const queryClient = useQueryClient();
  const [todoistApiKey, setTodoistApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');

  const authQuery = useQuery({
    queryKey: ['auth-status'],
    queryFn: async () => (await endpoints.authStatus()).data,
    refetchInterval: 30_000,
  });

  const incomingMessageChatsQuery = useQuery({
    queryKey: ['incoming-message-chats'],
    queryFn: async () => (await endpoints.incomingMessageChats()).data,
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await endpoints.settings()).data,
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      endpoints.updateSettings({
        ...(todoistApiKey ? { todoistApiKey } : {}),
        ...(openaiApiKey ? { openaiApiKey } : {}),
      }),
    onSuccess: () => {
      setTodoistApiKey('');
      setOpenaiApiKey('');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const syncMessages = useMutation({
    mutationFn: () => endpoints.syncMessages(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['incoming-message-chats'] });
    },
  });
  const flushAnalyzingChats = useMutation({
    mutationFn: () => endpoints.flushAnalyzingChats(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['incoming-message-chats'] });
    },
  });
  const connectUrl = `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}/auth/login`;

  const tabs: Array<{ path: string; label: string }> = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/settings', label: 'Settings' },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6 rounded-xl bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Teams ToDo Bot</h1>
        <p className="mt-1 text-sm text-slate-600">Teams sync + OpenAI task extraction + Todoist sync</p>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `rounded-md px-4 py-2 text-sm font-medium ${
                isActive ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={(
        <section className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="text-sm text-slate-500">Chats Tracked</div>
              <div className="mt-2 text-3xl font-semibold">{(incomingMessageChatsQuery.data ?? []).length}</div>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="text-sm text-slate-500">Messages Tracked</div>
              <div className="mt-2 text-3xl font-semibold">
                {(incomingMessageChatsQuery.data ?? []).reduce((total, chat) => total + chat.messagesAnalyzed, 0)}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Connection Status</h2>
              <div className="flex items-center gap-2">
                {authQuery.data?.authenticated && (
                  <button
                    onClick={() => syncMessages.mutate()}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    disabled={syncMessages.isPending}
                  >
                    {syncMessages.isPending ? 'Syncing...' : 'Sync Now'}
                  </button>
                )}
                {!authQuery.data?.authenticated && (
                  <a href={connectUrl} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white">
                    Connect Microsoft Account
                  </a>
                )}
              </div>
            </div>
            <p className="text-sm text-slate-600">
              {authQuery.data?.authenticated
                ? `Connected. Token expiry: ${authQuery.data.expiresAt ?? 'unknown'}`
                : 'Not connected to Microsoft yet.'}
            </p>
            {syncMessages.isSuccess && (
              <p className="mt-2 text-xs text-emerald-700">
                Queued {syncMessages.data.data.chatsQueued} chat sync job(s). Each job processes the latest{' '}
                {syncMessages.data.data.messageLimit} message(s) for one chat in sequence.
              </p>
            )}
            {syncMessages.isError && (
              <p className="mt-2 text-xs text-red-700">
                Sync failed: {readMutationError(syncMessages.error)}
              </p>
            )}
          </div>

          <section className="rounded-xl bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Processed Chat History</h2>
              <button
                onClick={() => flushAnalyzingChats.mutate()}
                className="rounded-md bg-slate-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={flushAnalyzingChats.isPending}
              >
                {flushAnalyzingChats.isPending ? 'Flushing...' : 'Flush Analyzing'}
              </button>
            </div>
            {flushAnalyzingChats.isSuccess && (
              <p className="mb-3 text-xs text-emerald-700">
                Flushed {flushAnalyzingChats.data.data.flushed} chat(s) stuck in analyzing.
              </p>
            )}
            {flushAnalyzingChats.isError && (
              <p className="mb-3 text-xs text-red-700">
                Flush failed: {readMutationError(flushAnalyzingChats.error)}
              </p>
            )}
            <div className="space-y-2">
              {(incomingMessageChatsQuery.data ?? []).map((chat) => (
                <div key={chat.chatId} className="rounded-md border border-slate-200 p-3 text-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{chat.chatName}</div>
                      <div className="text-xs text-slate-500">
                        Last analyzed:{' '}
                        {chat.lastAnalyzedAt ? new Date(chat.lastAnalyzedAt).toLocaleString() : 'not analyzed yet'}
                      </div>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-xs ${chatStatusClassName(chat.status)}`}>
                      {chatStatusLabel(chat.status)}
                    </span>
                  </div>
                  <div className="mb-2 text-xs text-slate-500">
                    Messages analyzed: {chat.messagesAnalyzed} | Tasks synced: {chat.tasksFound}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>
          )}
        />

        <Route
          path="/settings"
          element={(
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">API Keys</h2>
            <p className="text-sm text-slate-500">Todoist: {settingsQuery.data?.todoistApiKeyHint ?? 'not set'}</p>
            <p className="mb-3 text-sm text-slate-500">OpenAI: {settingsQuery.data?.openaiApiKeyHint ?? 'not set'}</p>
            <div className="space-y-3">
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                type="password"
                placeholder="New Todoist API key"
                value={todoistApiKey}
                onChange={(event) => setTodoistApiKey(event.target.value)}
              />
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                type="password"
                placeholder="New OpenAI API key"
                value={openaiApiKey}
                onChange={(event) => setOpenaiApiKey(event.target.value)}
              />
              <button
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                onClick={() => saveSettings.mutate()}
              >
                Save
              </button>
            </div>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">Microsoft 365</h2>
            <p className="text-sm text-slate-600">
              Status: {authQuery.data?.authenticated ? 'Connected' : 'Not connected'}
            </p>
            <a href={connectUrl} className="mt-3 inline-block rounded-md bg-blue-600 px-3 py-2 text-sm text-white">
              Reconnect
            </a>
          </div>
        </section>
          )}
        />
      </Routes>
    </div>
  );
}

function readMutationError(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'Unknown error';
  }
  const maybeResponse = error as { response?: { data?: { message?: unknown } } };
  const message = maybeResponse.response?.data?.message;
  if (typeof message === 'string' && message.trim().length > 0) {
    return message;
  }
  return 'Unknown error';
}

export default App;
