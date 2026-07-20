/**
 * extensions/todo/agent/types.ts — Type definitions for the Todo extension
 *
 * Moved from src/tools/todo/types.ts.
 * Defines TodoItem, TodoStatus, TodoPriority and the Zod schemas.
 */

import { z } from 'zod';
import type { PluginStateExtension } from '@agent-type';

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const todoItemSchema = z.object({
  id: z.number().int().positive().describe('Unique task identifier (reuse when updating).'),
  title: z.string().min(1).describe('Short, action-oriented description of the task.'),
  status: z
    .enum(['not-started', 'in-progress', 'completed', 'blocked'])
    .describe('Current status — not-started | in-progress | completed | blocked'),
  priority: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .describe('Optional priority. Omit when all tasks have equal priority.'),
});

export const todoArraySchema = z
  .array(todoItemSchema)
  .describe(
    'A single task entry. id must be unique (reuse when updating). ' +
    'status: not-started | in-progress | completed | blocked. ' +
    'Exactly one task may be in-progress at any time. ' +
    'Only set priority when it differs from the default.' +
    ' Submit the complete list, not just changes.',
  );

export const emptySchema = z.object({});

// ── Inferred types ────────────────────────────────────────────────────────────

export type TodoItem = z.infer<typeof todoItemSchema>;
export type TodoStatus = 'not-started' | 'in-progress' | 'completed' | 'blocked';
export type TodoPriority = 'low' | 'medium' | 'high';

// ── Symbol state interface ────────────────────────────────────────────────────

/**
 * The state slice returned by the todo ToolSet's `onGetSymbolState`.
 *
 * Stored under `state[TODO_SYMBOL]` in the session state, isolating
 * todo state from the root `AgentSessionState`.
 */
export interface TodoSymbolState extends PluginStateExtension {
  readonly type: 'todo';
  readonly todos: readonly TodoItem[];
}

// ── Module augmentation — direct field access in UI ──────────────────────────
// Single-ToolSet plugins augment PluginStateExtension so the iframe UI
// can access fields without casts: state?.todos, state?.tokenBudget, etc.

declare module "@agent-type" {
  interface PluginStateExtension {
    readonly todos: readonly TodoItem[];
  }
}
