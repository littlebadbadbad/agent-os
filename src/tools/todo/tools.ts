/**
 * Tool definitions for the task-tracking ToolSet.
 *
 * Provides `todo_write` and `todo_read` tools with rich descriptions
 * defined in `prompt.ts`.
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { MAIN_CONVERSATION_ID } from '../toolSet';
import { TODO_WRITE_DESCRIPTION, TODO_READ_DESCRIPTION, TODO_ITEM_DESCRIPTION } from './prompt';

// ── Schema ─────────────────────────────────────────────────────────────────────

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
  .describe(TODO_ITEM_DESCRIPTION + ' Submit the complete list, not just changes.');

export const emptySchema = z.object({});

// ── Helper ────────────────────────────────────────────────────────────────────

export function getTodoKey(sessionId: string, agentName: string, conversationId: string): string {
  return conversationId === MAIN_CONVERSATION_ID
    ? sessionId
    : `${sessionId}:${agentName}`;
}

// ── Tool factories ────────────────────────────────────────────────────────────

export type TodoStore = {
  get: (key: string) => TodoItem[];
  set: (key: string, items: TodoItem[]) => void;
  notify: (key: string) => void;
};

export type TodoItem = z.infer<typeof todoItemSchema>;

export function createTodoWriteTool(store: TodoStore) {
  return defineTool({
    name: 'todo_write',
    group: 'Tracking',
    description: TODO_WRITE_DESCRIPTION,
    parameters: z.object({
      todos: todoArraySchema,
    }),
    execute: async ({ todos: newTodos }, context) => {
      const todoKey = getTodoKey(context.sessionId, context.agentName, context.conversationId);
      const todos = newTodos as TodoItem[];
      store.set(todoKey, todos);
      store.notify(todoKey);

      const inProgress = todos.filter((t) => t.status === 'in-progress');
      if (inProgress.length > 1) {
        return {
          success: false,
          error: `Constraint violation: ${inProgress.length} tasks are "in-progress". Exactly one is allowed. Resubmit with only one in-progress task.`,
        };
      }

      const done = todos.filter((t) => t.status === 'completed').length;
      const active = inProgress.length;
      const blocked = todos.filter((t) => t.status === 'blocked').length;
      const pending = todos.filter((t) => t.status === 'not-started').length;

      return {
        success: true,
        summary: [`${done}/${todos.length} completed`,
          active ? `${active} in-progress` : null,
          blocked ? `${blocked} blocked` : null,
          pending ? `${pending} pending` : null,
        ]
          .filter(Boolean)
          .join(', '),
      };
    },
  });
}

export function createTodoReadTool(store: TodoStore) {
  return defineTool({
    name: 'todo_read',
    group: 'Tracking',
    description: TODO_READ_DESCRIPTION,
    parameters: emptySchema,
    execute: async (_, context) => {
      const todoKey = getTodoKey(context.sessionId, context.agentName, context.conversationId);
      const items = store.get(todoKey);
      if (items.length === 0) return { todos: [], message: 'No tasks yet.' };
      return { todos: items };
    },
  });
}
