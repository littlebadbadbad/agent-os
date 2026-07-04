import { describe, it, expect, vi } from 'vitest';
import { createTodoTools } from '../../tools/todo';
import { resolveToolSetTools, MAIN_CONVERSATION_ID } from '../../tools/toolSet';
import type { TodoItem } from '../../tools/todo';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'session-1') {
  return {
    sessionId,
    agentName: 'main',
    conversationId: MAIN_CONVERSATION_ID,
    signal: new AbortController().signal,
    requestUserInput: () => Promise.resolve(null),
  };
}

/**
 * ToolSetContext for lifecycle hook calls (main-agent scope).
 * Uses MAIN_CONVERSATION_ID so toolSetContextKey returns just sessionId.
 */
function makeTsCtx(sessionId = 'session-1') {
  return { sessionId, agentName: 'main', conversationId: MAIN_CONVERSATION_ID };
}

/**
 * Simulates a sub-agent tool execution context.
 * Key behaviour: conversationId !== sessionId (different unique conv ID).
 * The todo key becomes `"${sessionId}:${agentName}"`.
 */
function makeSubAgentCtx(
  agentName: string,
  convId: string,
  sessionId = 'session-1',
) {
  return {
    sessionId,
    agentName,
    conversationId: convId,   // sub-agent: conversationId !== sessionId
    signal: new AbortController().signal,
    requestUserInput: () => Promise.resolve(null),
  };
}

async function writeTodos(
  toolSet: ReturnType<typeof createTodoTools>,
  todos: TodoItem[],
  sessionId = 'session-1',
) {
  const writeTool = resolveToolSetTools(toolSet).find((t) => t.name === 'todo_write')!;
  return writeTool.execute({ todos }, makeCtx(sessionId));
}

async function readTodos(
  toolSet: ReturnType<typeof createTodoTools>,
  sessionId = 'session-1',
) {
  const readTool = resolveToolSetTools(toolSet).find((t) => t.name === 'todo_read')!;
  return readTool.execute({}, makeCtx(sessionId)) as Promise<{ todos: TodoItem[]; message?: string }>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createTodoTools', () => {
  // ── ToolSet shape ──────────────────────────────────────────────────────────

  it('returns a ToolSet with name "todo"', () => {
    const ts = createTodoTools();
    expect(ts.name).toBe('todo');
  });

  it('exports exactly two tools: todo_write and todo_read', () => {
    const ts = createTodoTools();
    const names = resolveToolSetTools(ts).map((t) => t.name);
    expect(names).toContain('todo_write');
    expect(names).toContain('todo_read');
    expect(resolveToolSetTools(ts)).toHaveLength(2);
  });

  // ── todo_read (empty) ──────────────────────────────────────────────────────

  it('todo_read returns empty list with message before any writes', async () => {
    const ts = createTodoTools();
    const result = await readTodos(ts);
    expect(result.todos).toEqual([]);
    expect(result.message).toBe('No tasks yet.');
  });

  // ── todo_write + todo_read round-trip ─────────────────────────────────────

  it('writes todos and reads them back', async () => {
    const ts = createTodoTools();
    const todos: TodoItem[] = [
      { id: 1, title: 'Buy milk', status: 'not-started' },
      { id: 2, title: 'Walk dog', status: 'in-progress' },
    ];
    await writeTodos(ts, todos);
    const result = await readTodos(ts);
    expect(result.todos).toEqual(todos);
  });

  it('todo_write returns a summary describing counts', async () => {
    const ts = createTodoTools();
    const todos: TodoItem[] = [
      { id: 1, title: 'T1', status: 'completed' },
      { id: 2, title: 'T2', status: 'in-progress' },
      { id: 3, title: 'T3', status: 'not-started' },
      { id: 4, title: 'T4', status: 'blocked' },
    ];
    const result = (await writeTodos(ts, todos)) as { success: boolean; summary: string; todos: TodoItem[] };
    expect(result.success).toBe(true);
    expect(result.summary).toContain('1/4 completed');
    expect(result.summary).toContain('in-progress');
    expect(result.summary).toContain('blocked');
    expect(result.summary).toContain('pending');
  });

  it('overwrites previous todos on each write call', async () => {
    const ts = createTodoTools();
    await writeTodos(ts, [{ id: 1, title: 'Old', status: 'not-started' }]);
    await writeTodos(ts, [{ id: 1, title: 'New', status: 'completed' }]);
    const result = await readTodos(ts);
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0].title).toBe('New');
  });

  // ── Session isolation ──────────────────────────────────────────────────────

  it('maintains separate state per sessionId', async () => {
    const ts = createTodoTools();
    await writeTodos(ts, [{ id: 1, title: 'A-only', status: 'not-started' }], 'session-a');
    await writeTodos(ts, [{ id: 1, title: 'B-only', status: 'in-progress' }], 'session-b');

    const resultA = await readTodos(ts, 'session-a');
    const resultB = await readTodos(ts, 'session-b');
    expect(resultA.todos[0].title).toBe('A-only');
    expect(resultB.todos[0].title).toBe('B-only');
  });

  it('uses the sessionId from context as the key', async () => {
    const ts = createTodoTools();
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'todo_write')!;
    const readTool = resolveToolSetTools(ts).find((t) => t.name === 'todo_read')!;
    await writeTool.execute({ todos: [{ id: 1, title: 'T', status: 'not-started' }] }, makeCtx('default'));
    const result = await readTool.execute({}, makeCtx('default')) as { todos: TodoItem[] };
    expect(result.todos).toHaveLength(1);
  });

  // ── ToolSet lifecycle hooks ────────────────────────────────────────────────

  it('onInitSession pre-populates todos from entryData.todos', async () => {
    const ts = createTodoTools();
    const initial: TodoItem[] = [{ id: 99, title: 'Restored', status: 'in-progress' }];
    ts.onInitSession!(makeTsCtx('session-restore'), { id: 'session-restore', title: 'Test', todos: initial });
    const result = await readTodos(ts, 'session-restore');
    expect(result.todos).toEqual(initial);
  });

  it('onInitSession skips pre-population when todos is empty', async () => {
    const ts = createTodoTools();
    ts.onInitSession!(makeTsCtx('session-empty'), { id: 'session-empty', title: 'Test', todos: [] });
    const result = await readTodos(ts, 'session-empty');
    expect(result.todos).toHaveLength(0);
  });

  it('onRemoveSession cleans up session state', async () => {
    const ts = createTodoTools();
    await writeTodos(ts, [{ id: 1, title: 'T', status: 'not-started' }], 'session-gc');
    ts.onRemoveSession!(makeTsCtx('session-gc'));
    // After removal, reading should give empty state (new session effectively)
    const result = await readTodos(ts, 'session-gc');
    expect(result.todos).toHaveLength(0);
  });

  it('onResetSession clears todos for the session', async () => {
    const ts = createTodoTools();
    await writeTodos(ts, [{ id: 1, title: 'T', status: 'not-started' }], 'session-reset');
    ts.onResetSession!(makeTsCtx('session-reset'));
    const result = await readTodos(ts, 'session-reset');
    expect(result.todos).toHaveLength(0);
  });

  it('onGetState returns the current todos for a session', async () => {
    const ts = createTodoTools();
    const todos: TodoItem[] = [{ id: 1, title: 'T', status: 'not-started' }];
    await writeTodos(ts, todos, 'session-state');
    const state = ts.onGetState!(makeTsCtx('session-state')) as { todos: TodoItem[] };
    expect(state.todos).toEqual(todos);
  });

  // ── Subscription ──────────────────────────────────────────────────────────

  it('onSubscribe notifies subscriber when todos change', async () => {
    const ts = createTodoTools();
    const listener = vi.fn();
    ts.onSubscribe!(makeTsCtx('session-sub'), listener);
    await writeTodos(ts, [{ id: 1, title: 'X', status: 'not-started' }], 'session-sub');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('onSubscribe returns an unsubscribe function that stops notifications', async () => {
    const ts = createTodoTools();
    const listener = vi.fn();
    const unsub = ts.onSubscribe!(makeTsCtx('session-unsub'), listener);
    unsub();
    await writeTodos(ts, [{ id: 1, title: 'X', status: 'not-started' }], 'session-unsub');
    expect(listener).not.toHaveBeenCalled();
  });

  it('onSubscribe called twice for the same session uses the existing subscribers Set', async () => {
    // Covers the false branch of `if (!subs)` in getSubs (line 74)
    const ts = createTodoTools();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    // First call creates the Set, second call reuses it
    ts.onSubscribe!(makeTsCtx('session-dual'), listener1);
    ts.onSubscribe!(makeTsCtx('session-dual'), listener2);
    await writeTodos(ts, [{ id: 1, title: 'X', status: 'not-started' }], 'session-dual');
    // Both listeners should have been notified
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('onGetState returns empty array for a session that has never had todos written', () => {
    // Covers the `?? []` false branch in onGetState (line 171)
    const ts = createTodoTools();
    const state = ts.onGetState!(makeTsCtx('brand-new-session')) as { todos: TodoItem[] };
    expect(state.todos).toEqual([]);
  });

  // ── onBuildSnapshot ───────────────────────────────────────────────────────

  it('onBuildSnapshot returns todos when the session has todos', async () => {
    const ts = createTodoTools();
    const todos: TodoItem[] = [{ id: 1, title: 'T', status: 'not-started' }];
    await writeTodos(ts, todos, 'session-snap');
    const snap = ts.onBuildSnapshot!(makeTsCtx('session-snap'));
    expect(snap).toEqual({ todos });
  });

  it('onBuildSnapshot returns empty object when the session has no todos', () => {
    const ts = createTodoTools();
    const snap = ts.onBuildSnapshot!(makeTsCtx('session-empty-snap'));
    expect(snap).toEqual({});
  });

  it('onBuildSnapshot returns empty object after session todos are cleared', async () => {
    const ts = createTodoTools();
    await writeTodos(ts, [{ id: 1, title: 'T', status: 'not-started' }], 'session-cleared');
    ts.onResetSession!(makeTsCtx('session-cleared'));
    const snap = ts.onBuildSnapshot!(makeTsCtx('session-cleared'));
    expect(snap).toEqual({});
  });

  it('todo_write summary omits null sections when all tasks are completed', async () => {
    // Covers the `null` branches for active, blocked, pending ternaries
    const ts = createTodoTools();
    const result = (await writeTodos(ts, [
      { id: 1, title: 'Done', status: 'completed' },
      { id: 2, title: 'Also done', status: 'completed' },
    ])) as { summary: string };
    expect(result.summary).toBe('2/2 completed');
    expect(result.summary).not.toContain('in-progress');
    expect(result.summary).not.toContain('blocked');
    expect(result.summary).not.toContain('pending');
  });

  // ── Per-agent isolation (sub-agent vs. main agent) ────────────────────────

  it('sub-agents are isolated from the main agent in the same session', async () => {
    const ts = createTodoTools();
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'todo_write')!;
    const readTool  = resolveToolSetTools(ts).find((t) => t.name === 'todo_read')!;

    const mainCtx       = makeCtx('session-1');
    const subAgentCtx   = makeSubAgentCtx('researcher_agent', 'conv-abc', 'session-1');

    await writeTool.execute({ todos: [{ id: 1, title: 'Main task', status: 'not-started' }] }, mainCtx);
    await writeTool.execute({ todos: [{ id: 1, title: 'Sub task', status: 'in-progress' }] }, subAgentCtx);

    const mainResult = await readTool.execute({}, mainCtx)     as { todos: TodoItem[] };
    const subResult  = await readTool.execute({}, subAgentCtx) as { todos: TodoItem[] };

    expect(mainResult.todos).toHaveLength(1);
    expect(mainResult.todos[0].title).toBe('Main task');

    expect(subResult.todos).toHaveLength(1);
    expect(subResult.todos[0].title).toBe('Sub task');
  });

  it('different sub-agents in the same session are isolated from each other', async () => {
    const ts = createTodoTools();
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'todo_write')!;
    const readTool  = resolveToolSetTools(ts).find((t) => t.name === 'todo_read')!;

    const researcherCtx = makeSubAgentCtx('researcher_agent', 'conv-1', 'session-1');
    const writerCtx     = makeSubAgentCtx('writer_agent',     'conv-2', 'session-1');

    await writeTool.execute({ todos: [{ id: 1, title: 'Research task', status: 'not-started' }] }, researcherCtx);
    await writeTool.execute({ todos: [{ id: 1, title: 'Write task',    status: 'in-progress'  }] }, writerCtx);

    const researcherResult = await readTool.execute({}, researcherCtx) as { todos: TodoItem[] };
    const writerResult     = await readTool.execute({}, writerCtx)     as { todos: TodoItem[] };

    expect(researcherResult.todos[0].title).toBe('Research task');
    expect(writerResult.todos[0].title).toBe('Write task');
  });

  it('all conversations of the same sub-agent share one todo list', async () => {
    const ts = createTodoTools();
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'todo_write')!;
    const readTool  = resolveToolSetTools(ts).find((t) => t.name === 'todo_read')!;

    // Same agent, two different conversations
    const conv1Ctx = makeSubAgentCtx('researcher_agent', 'conv-1', 'session-1');
    const conv2Ctx = makeSubAgentCtx('researcher_agent', 'conv-2', 'session-1');

    await writeTool.execute({ todos: [{ id: 1, title: 'Shared task', status: 'not-started' }] }, conv1Ctx);

    // Reading from a different conversation of the same agent should see the same todos
    const result = await readTool.execute({}, conv2Ctx) as { todos: TodoItem[] };
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0].title).toBe('Shared task');
  });
});
