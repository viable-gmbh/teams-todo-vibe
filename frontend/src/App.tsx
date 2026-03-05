import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { endpoints } from './api';
import type { IncomingMessageChat, InternalTask } from './api';

const REACTION_OPTIONS = [
  { value: 'wrench', label: 'Wrench (🔧)' },
  { value: 'thumbsup', label: 'Thumbs Up (👍)' },
  { value: 'heart', label: 'Heart (❤️)' },
];

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
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [reactionEmoji, setReactionEmoji] = useState('wrench');
  const [completionReplyDe, setCompletionReplyDe] = useState('Erledigt.');
  const [completionReplyEn, setCompletionReplyEn] = useState('Done.');
  const [newTaskText, setNewTaskText] = useState('');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<InternalTask | null>(null);

  const authQuery = useQuery({
    queryKey: ['auth-status'],
    queryFn: async () => (await endpoints.authStatus()).data,
    refetchInterval: 30_000,
  });

  const incomingMessageChatsQuery = useQuery({
    queryKey: ['incoming-message-chats'],
    queryFn: async () => (await endpoints.incomingMessageChats()).data,
    enabled: authQuery.data?.authenticated === true,
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await endpoints.settings()).data,
    enabled: authQuery.data?.authenticated === true,
  });
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => (await endpoints.tasks()).data,
    enabled: authQuery.data?.authenticated === true,
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    setReactionEmoji(settingsQuery.data.reactionEmoji || 'wrench');
    setCompletionReplyDe(settingsQuery.data.completionReplyDe || 'Erledigt.');
    setCompletionReplyEn(settingsQuery.data.completionReplyEn || 'Done.');
  }, [settingsQuery.data]);

  const saveSettings = useMutation({
    mutationFn: () =>
      endpoints.updateSettings({
        ...(openaiApiKey ? { openaiApiKey } : {}),
        reactionEmoji,
        completionReplyDe,
        completionReplyEn,
      }),
    onSuccess: () => {
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
  const createTask = useMutation({
    mutationFn: (text: string) =>
      endpoints.createTask({
        text,
      }),
    onMutate: async (text) => {
      const previousTasks = queryClient.getQueryData<InternalTask[]>(['tasks']) ?? [];
      const nextSortOrder =
        previousTasks.reduce((max, task) => Math.max(max, task.sortOrder ?? 0), 0) + 1;
      const tempId = `temp-${Date.now()}`;
      const optimisticTask: InternalTask = {
        id: tempId,
        text,
        description: null,
        sortOrder: nextSortOrder,
        priority: 'p4',
        due: null,
        assignee: null,
        done: false,
        sourceType: 'CUSTOM',
        autoReplyEnabled: false,
        sourceMessageText: null,
        sourceLanguage: null,
        completionNotifiedAt: null,
        completedAt: null,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData<InternalTask[]>(['tasks'], [...previousTasks, optimisticTask]);
      setNewTaskText('');
      return { previousTasks, tempId };
    },
    onError: (_error, _text, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks'], context.previousTasks);
      }
    },
    onSuccess: (response, _text, context) => {
      const createdTask = response.data;
      queryClient.setQueryData<InternalTask[]>(['tasks'], (current) =>
        (current ?? []).map((task) => (task.id === context?.tempId ? createdTask : task)),
      );
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const setTaskDone = useMutation({
    mutationFn: ({ taskId, done }: { taskId: string; done: boolean }) =>
      endpoints.setTaskDone(taskId, done),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const updateTask = useMutation({
    mutationFn: ({
      taskId,
      payload,
    }: {
      taskId: string;
      payload: {
        text?: string;
        description?: string | null;
        priority?: 'p1' | 'p2' | 'p3' | 'p4';
        due?: string | null;
        assignee?: string | null;
        autoReplyEnabled?: boolean;
      };
    }) => endpoints.updateTask(taskId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const deleteTask = useMutation({
    mutationFn: (taskId: string) => endpoints.deleteTask(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const reorderTasks = useMutation({
    mutationFn: (taskIds: string[]) => endpoints.reorderTasks(taskIds),
    onMutate: async (taskIds) => {
      const previousTasks = queryClient.getQueryData<InternalTask[]>(['tasks']) ?? [];
      const byId = new Map(previousTasks.map((task) => [task.id, task]));
      const reordered = taskIds
        .map((id, index) => {
          const task = byId.get(id);
          if (!task) {
            return null;
          }
          return {
            ...task,
            sortOrder: index + 1,
          };
        })
        .filter((task): task is InternalTask => task !== null);
      queryClient.setQueryData<InternalTask[]>(['tasks'], reordered);
      return { previousTasks };
    },
    onError: (_error, _taskIds, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks'], context.previousTasks);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const connectUrl = `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}/auth/login`;
  const isAuthenticated = authQuery.data?.authenticated === true;

  const tabs: Array<{ path: string; label: string }> = [
    { path: '/tasks', label: 'Tasks' },
    { path: '/dashboard', label: 'Message Log' },
    { path: '/settings', label: 'Settings' },
  ];

  if (authQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl bg-white p-6 shadow-sm">Checking sign-in status...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">DoneBetter</h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in with Microsoft first. Your data stays isolated to your account.
          </p>
          <a
            href={connectUrl}
            className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          >
            Connect Microsoft Account
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6 rounded-xl bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">DoneBetter</h1>
        <p className="mt-1 text-sm text-slate-600">Teams sync + OpenAI task extraction + internal todo list</p>
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
        <Route path="/" element={<Navigate to="/tasks" replace />} />
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
                  <>
                    <button
                      onClick={() => syncMessages.mutate()}
                      className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      disabled={syncMessages.isPending}
                    >
                      {syncMessages.isPending ? 'Syncing...' : 'Sync Reactions'}
                    </button>
                  </>
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
          path="/tasks"
          element={(
            <section className="space-y-4">
              <div className="rounded-xl bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-lg font-semibold">Quick Add Custom Task</h2>
                <form
                  className="grid gap-2 md:grid-cols-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const title = newTaskText.trim();
                    if (title.length < 3 || createTask.isPending) {
                      return;
                    }
                    createTask.mutate(title);
                  }}
                >
                  <input
                    className="md:col-span-3 rounded-md border border-slate-300 px-3 py-2"
                    placeholder="Type title and press Enter"
                    value={newTaskText}
                    onChange={(event) => setNewTaskText(event.target.value)}
                  />
                  <button
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    type="submit"
                    disabled={createTask.isPending || newTaskText.trim().length < 3}
                  >
                    {createTask.isPending ? 'Creating...' : 'Add'}
                  </button>
                </form>
              </div>

              <div className="rounded-xl bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-lg font-semibold">Internal Tasks (drag to sort)</h2>
                <div className="space-y-2">
                  {(tasksQuery.data ?? []).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      isDragging={draggingTaskId === task.id}
                      onOpen={() => setEditingTask(task)}
                      onDragStart={() => setDraggingTaskId(task.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (!draggingTaskId || draggingTaskId === task.id) {
                          return;
                        }
                        const ordered = buildReorderedIds(tasksQuery.data ?? [], draggingTaskId, task.id);
                        if (ordered.length > 0) {
                          reorderTasks.mutate(ordered);
                        }
                        setDraggingTaskId(null);
                      }}
                      onDragEnd={() => setDraggingTaskId(null)}
                      onToggleDone={(done) => setTaskDone.mutate({ taskId: task.id, done })}
                      onToggleAutoReply={(enabled) =>
                        updateTask.mutate({ taskId: task.id, payload: { autoReplyEnabled: enabled } })
                      }
                      onDelete={() => deleteTask.mutate(task.id)}
                    />
                  ))}
                </div>
              </div>
              {editingTask && (
                <TaskEditModal
                  key={editingTask.id}
                  task={editingTask}
                  onClose={() => setEditingTask(null)}
                  onSave={async (draft) => {
                    await updateTask.mutateAsync({
                      taskId: editingTask.id,
                      payload: {
                        text: draft.text,
                        description: draft.description,
                        priority: draft.priority,
                        due: draft.due,
                        assignee: draft.assignee,
                        autoReplyEnabled: draft.autoReplyEnabled,
                      },
                    });
                    if (draft.done !== editingTask.done) {
                      await setTaskDone.mutateAsync({ taskId: editingTask.id, done: draft.done });
                    }
                    setEditingTask(null);
                  }}
                />
              )}
            </section>
          )}
        />

        <Route
          path="/settings"
          element={(
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">API Keys</h2>
            <p className="mb-3 text-sm text-slate-500">OpenAI: {settingsQuery.data?.openaiApiKeyHint ?? 'not set'}</p>
            <div className="space-y-3">
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
            <h2 className="mb-3 text-lg font-semibold">Automation</h2>
            <div className="space-y-3">
              <label className="block text-sm text-slate-600">
                Reaction emoji trigger
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  value={reactionEmoji}
                  onChange={(event) => setReactionEmoji(event.target.value)}
                >
                  {REACTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-600">
                Completion reply (German)
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  value={completionReplyDe}
                  onChange={(event) => setCompletionReplyDe(event.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-600">
                Completion reply (English)
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  value={completionReplyEn}
                  onChange={(event) => setCompletionReplyEn(event.target.value)}
                />
              </label>
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

function TaskRow(props: {
  task: InternalTask;
  isDragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onToggleDone: (done: boolean) => void;
  onToggleAutoReply: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const { task } = props;
  return (
    <div
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      onClick={props.onOpen}
      className={`rounded-md border p-3 text-sm cursor-pointer ${props.isDragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={task.done}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => props.onToggleDone(event.target.checked)}
          />
          <span className={task.done ? 'text-slate-400 line-through' : 'text-slate-900'}>{task.text}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{task.priority}</span>
          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
            {task.sourceType === 'AUTO_DETECTED' ? 'auto-detected' : 'custom'}
          </span>
        </div>
        <button
          className="rounded bg-red-100 px-2 py-1 text-xs text-red-700"
          onClick={(event) => {
            event.stopPropagation();
            props.onDelete();
          }}
        >
          Delete
        </button>
      </div>
      {task.description && (
        <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{task.description}</p>
      )}
      {task.sourceType === 'AUTO_DETECTED' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={task.autoReplyEnabled}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => props.onToggleAutoReply(event.target.checked)}
            />
            Auto-reply when done
          </label>
          {task.completionNotifiedAt && (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">reply sent</span>
          )}
        </div>
      )}
    </div>
  );
}

function buildReorderedIds(tasks: InternalTask[], draggedId: string, targetId: string): string[] {
  const ids = tasks.map((task) => task.id);
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) {
    return ids;
  }
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function TaskEditModal(props: {
  task: InternalTask;
  onClose: () => void;
  onSave: (draft: {
    text: string;
    description: string | null;
    priority: 'p1' | 'p2' | 'p3' | 'p4';
    due: string | null;
    assignee: string | null;
    autoReplyEnabled: boolean;
    done: boolean;
  }) => Promise<void>;
}) {
  const [text, setText] = useState(props.task.text);
  const [description, setDescription] = useState(props.task.description ?? '');
  const [priority, setPriority] = useState<'p1' | 'p2' | 'p3' | 'p4'>(props.task.priority);
  const [due, setDue] = useState(props.task.due ?? '');
  const [assignee, setAssignee] = useState(props.task.assignee ?? '');
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(props.task.autoReplyEnabled);
  const [done, setDone] = useState(props.task.done);
  const [saving, setSaving] = useState(false);
  const hasUnsavedChanges =
    text !== props.task.text ||
    (description.trim() || null) !== (props.task.description ?? null) ||
    priority !== props.task.priority ||
    (due.trim() || null) !== (props.task.due ?? null) ||
    (assignee.trim() || null) !== (props.task.assignee ?? null) ||
    autoReplyEnabled !== props.task.autoReplyEnabled ||
    done !== props.task.done;

  const attemptClose = useCallback(() => {
    if (saving) {
      return;
    }
    if (hasUnsavedChanges) {
      const shouldDiscard = window.confirm('You have unsaved changes. Discard them?');
      if (!shouldDiscard) {
        return;
      }
    }
    props.onClose();
  }, [hasUnsavedChanges, saving, props]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        attemptClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [attemptClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={attemptClose}
    >
      <div className="w-full max-w-xl rounded-xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edit To-Do</h3>
          <button className="rounded bg-slate-100 px-2 py-1 text-xs" onClick={attemptClose}>Close</button>
        </div>
        <div className="space-y-3">
          <input className="w-full rounded border border-slate-300 px-3 py-2" value={text} onChange={(e)=>setText(e.target.value)} />
          <textarea className="w-full rounded border border-slate-300 px-3 py-2" rows={4} value={description} onChange={(e)=>setDescription(e.target.value)} />
          <div className="grid gap-2 md:grid-cols-3">
            <select className="rounded border border-slate-300 px-3 py-2" value={priority} onChange={(e)=>setPriority(e.target.value as 'p1' | 'p2' | 'p3' | 'p4')}>
              <option value="p1">P1</option>
              <option value="p2">P2</option>
              <option value="p3">P3</option>
              <option value="p4">P4</option>
            </select>
            <input className="rounded border border-slate-300 px-3 py-2" placeholder="Due (optional)" value={due} onChange={(e)=>setDue(e.target.value)} />
            <input className="rounded border border-slate-300 px-3 py-2" placeholder="Assignee (optional)" value={assignee} onChange={(e)=>setAssignee(e.target.value)} />
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={done} onChange={(e)=>setDone(e.target.checked)} />
              Done
            </label>
            {props.task.sourceType === 'AUTO_DETECTED' && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={autoReplyEnabled} onChange={(e)=>setAutoReplyEnabled(e.target.checked)} />
                Auto-reply when done
              </label>
            )}
          </div>
          <button
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            disabled={saving || text.trim().length < 3}
            onClick={async () => {
              setSaving(true);
              try {
                await props.onSave({
                  text: text.trim(),
                  description: description.trim() || null,
                  priority,
                  due: due.trim() || null,
                  assignee: assignee.trim() || null,
                  autoReplyEnabled,
                  done,
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
