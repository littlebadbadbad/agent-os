/**
 * Task-tracking ToolSet factory.
 *
 * Provides `todo_write` and `todo_read` tools along with session lifecycle
 * hooks for per-agent state isolation.  Each agent (main + sub-agents) gets
 * its own isolated task list.
 *
 * This ToolSet registers with `sectionId: 'task_tracking'` so it participates
 * in the section-based system-prompt ordering and deduplication pipeline.
 */

// ── Module augmentation ───────────────────────────────────────────────────────
import type { TodoItem } from './tools';
import type { ToolSet, ToolSetContext } from '@agent-type';

export {};

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Todo items to preload for this session. */
    todos?: TodoItem[];
  }
}

declare module '@agent-type' {
  interface AgentSessionExtension {
    /** Current todo list (empty array when no todo ToolSet is registered). */
    todos: readonly TodoItem[];
  }
}

import { toolSetContextKey } from '../toolSet';
import { createTodoWriteTool, createTodoReadTool, getTodoKey } from './tools';
import { buildTaskTrackingSectionContent, SECTION_ID } from './prompt';

// re-export for convenience
export type { TodoItem, TodoStatus, TodoPriority } from './types';

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the built-in task-tracking ToolSet.
 *
 * Each agent (main + sub-agents) gets its own isolated task list.  A single
 * instance manages task lists for all agents via an internal `Map<key, TodoItem[]>`
 * where the key is:
 *   - `sessionId`                  — for the root (main) agent
 *   - `"${sessionId}:${agentName}"` — for each sub-agent
 *
 * @example
 * ```ts
 * const todoToolSet = createTodoTools();
 * const agent = createAgentClient({ handler, toolSets: [todoToolSet] });
 * agent.render();
 * ```
 */
export function createTodoTools(): ToolSet {
  // Per-session state: sessionId → todo items
  const sessionTodos = new Map<string, TodoItem[]>();
  // Per-session subscribers: sessionId → Set<listener>
  const sessionSubscribers = new Map<string, Set<() => void>>();

  function getItems(sessionId: string): TodoItem[] {
    let items = sessionTodos.get(sessionId);
    if (!items) { items = []; sessionTodos.set(sessionId, items); }
    return items;
  }

  function setItems(sessionId: string, items: TodoItem[]): void {
    sessionTodos.set(sessionId, items);
  }

  function getSubs(sessionId: string): Set<() => void> {
    let subs = sessionSubscribers.get(sessionId);
    if (!subs) { subs = new Set(); sessionSubscribers.set(sessionId, subs); }
    return subs;
  }

  function notifySession(sessionId: string): void {
    sessionSubscribers.get(sessionId)?.forEach((fn) => fn());
  }

  // Create the store adapter consumed by tools
  const store = {
    get: (key: string) => getItems(key),
    set: (key: string, items: TodoItem[]) => setItems(key, items),
    notify: (key: string) => notifySession(key),
  };

  // ── Tools ──────────────────────────────────────────────────────

  const todoWrite = createTodoWriteTool(store);
  const todoRead = createTodoReadTool(store);

  // ── ToolSet interface ────────────────────────────────────────────────────────

  const toolSet: ToolSet = {
    name: 'todo',
    description: 'Task tracking: decompose work into items, mark progress, track completion.',
    coreTools: ['todo_write', 'todo_read'],
    sectionId: SECTION_ID,
    sectionPriority: 40,
    tools: [todoWrite, todoRead],

    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      const key = toolSetContextKey(ctx);
      const items = sessionTodos.get(key);
      return buildTaskTrackingSectionContent(items);
    },

    onInitSession(ctx: ToolSetContext, entryData): void {
      const key = toolSetContextKey(ctx);
      const data = entryData as unknown as Record<string, unknown>;
      if (data.todos) {
        const restored = data.todos as TodoItem[];
        if (restored?.length) {
          sessionTodos.set(key, [...restored]);
        }
      }
    },

    onRemoveSession(ctx: ToolSetContext): void {
      const key = toolSetContextKey(ctx);
      sessionTodos.delete(key);
      sessionSubscribers.delete(key);
    },

    onResetSession(ctx: ToolSetContext): void {
      const key = toolSetContextKey(ctx);
      sessionTodos.set(key, []);
      notifySession(key);
    },

    onGetState(ctx: ToolSetContext) {
      return { todos: sessionTodos.get(toolSetContextKey(ctx)) ?? [] };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      const subs = getSubs(toolSetContextKey(ctx));
      subs.add(fn);
      return () => subs.delete(fn);
    },

    onBuildSnapshot(ctx: ToolSetContext) {
      const items = sessionTodos.get(toolSetContextKey(ctx));
      return items?.length ? { todos: [...items] } : {};
    },
  };
  return toolSet;
}
