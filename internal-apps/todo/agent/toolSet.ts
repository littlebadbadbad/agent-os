/**
 * internal-apps/todo/agent/toolSet.ts — Task-tracking ToolSet factory
 *
 * Moved from src/tools/todo/toolSet.ts.
 *
 * Key changes from the original:
 * - Uses `onGetSymbolState` instead of `onGetState` (isolated symbol state)
 * - Declares `symbol: TODO_SYMBOL` on the ToolSet
 * - Declares UI slots: panel (with badge), toolCard, compactToolCard
 * - Module augmentation for `SessionEntryExtension.todos` stays here
 */

// ── Module augmentation ───────────────────────────────────────────────────────
import type { TodoItem } from './types';
import type { ToolSet, ToolSetContext, SlotDeclaration, SessionEntryData } from '@agent-type';

export { };

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Todo items to preload for this session. */
    todos?: TodoItem[];
  }
}

import { ctxKey } from '@agent-type';
import type { CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';
import { createTodoWriteTool, createTodoReadTool } from './tools';
import { buildTaskTrackingSectionContent } from './prompt';
import type { TodoSymbolState } from './types';

// ── Symbol ────────────────────────────────────────────────────────────────────

export const TODO_SYMBOL = Symbol('todo');

// ── Compact tool-card descriptor helpers ──────────────────────────────────────

function argArr(args: Record<string, unknown>, key: string): unknown[] {
  const v = args[key];
  return Array.isArray(v) ? v : [];
}

function todoDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const isWrite = info.name === "todo_write";
  const label = isWrite ? "Tasks" : "Read";
  const rawTodos = isWrite ? argArr(info.arguments, "todos") : [];
  const todos = rawTodos.filter(
    (v): v is { status: string } =>
      v !== null && typeof v === "object" && typeof (v as Record<string, unknown>).status === "string",
  ) as { status: string }[];
  const done = todos.filter((t) => t.status === "completed").length;
  const summary = todos.length > 0 ? `${done}/${todos.length}` : "";
  return { icon: "☑", label, summary, status: info.status };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the task-tracking ToolSet.
 *
 * Each agent (main + sub-agents) gets its own isolated task list.  A single
 * instance manages task lists for all agents via an internal `Map<key, TodoItem[]>`
 * where the key is derived from `ctxKey(ctx)`:
 *   - `sessionId`                   — for the root (main) agent
 *   - `"${sessionId}:${agentName}"` — for each sub-agent
 */
export function createTodoTools(): ToolSet {
  // Per-session state: key → todo items
  const sessionTodos = new Map<string, TodoItem[]>();
  // Per-session subscribers: key → Set<listener>
  const sessionSubscribers = new Map<string, Set<() => void>>();

  function getItems(key: string): TodoItem[] {
    let items = sessionTodos.get(key);
    if (!items) { items = []; sessionTodos.set(key, items); }
    return items;
  }

  function setItems(key: string, items: TodoItem[]): void {
    sessionTodos.set(key, items);
  }

  function getSubs(key: string): Set<() => void> {
    let subs = sessionSubscribers.get(key);
    if (!subs) { subs = new Set(); sessionSubscribers.set(key, subs); }
    return subs;
  }

  function notifySession(key: string): void {
    sessionSubscribers.get(key)?.forEach((fn) => fn());
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

  const toolNames = [todoWrite.name, todoRead.name];

  const todoSlotDeclarations: readonly SlotDeclaration[] = [
    {
      type: 'panel',
      label: 'Todo',
      showTab: (_ctx, state) => (state?.todos?.length ?? 0) > 0,
      badge: (_ctx, state) => {
        const items = state?.todos;
        if (!items || items.length === 0) return null;
        const done = items.filter((t) => t.status === 'completed').length;
        const active = items.filter((t) => t.status === 'in-progress').length;
        return active > 0 ? `${done}/${items.length} ◎` : `${done}/${items.length}`;
      },
    },
    {
      type: 'toolCard',
      toolNames,
    },
    {
      type: 'compactToolCard',
      toolNames,
      getDescriptor: todoDescriptor,
    },
  ] satisfies readonly SlotDeclaration[];

  // ── ToolSet interface ────────────────────────────────────────────────────────

  const toolSet: ToolSet = {
    symbol: TODO_SYMBOL,
    name: 'todo',
    description: 'Task tracking: decompose work into items, mark progress, track completion.',
    tools: [todoWrite, todoRead],

    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      const key = ctxKey(ctx);
      const items = sessionTodos.get(key);
      return buildTaskTrackingSectionContent(items);
    },

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      const key = ctxKey(ctx);
      const data = entryData as unknown as Record<string, unknown> | undefined;
      const todos = data?.todos as TodoItem[] | undefined;
      if (todos?.length) {
        sessionTodos.set(key, [...todos]);
      }
    },

    onRemove(ctx: ToolSetContext): void {
      const key = ctxKey(ctx);
      sessionTodos.delete(key);
      sessionSubscribers.delete(key);
    },

    onReset(ctx: ToolSetContext): void {
      const key = ctxKey(ctx);
      sessionTodos.set(key, []);
      notifySession(key);
    },

    onGetSymbolState(ctx: ToolSetContext) {
      const key = ctxKey(ctx);
      const items = sessionTodos.get(key) ?? [];
      return {
        type: 'todo',
        todos: items,
      };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      const subs = getSubs(ctxKey(ctx));
      subs.add(fn);
      return () => subs.delete(fn);
    },

    onBuildSnapshot(ctx: ToolSetContext) {
      const items = sessionTodos.get(ctxKey(ctx));
      return items?.length ? { todos: [...items] } : {};
    },
    todoSlotDeclarations,
  } as ToolSet & { readonly todoSlotDeclarations: readonly SlotDeclaration[] };
  return toolSet;
}
