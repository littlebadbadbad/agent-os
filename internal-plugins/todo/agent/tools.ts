/**
 * internal-plugins/todo/agent/tools.ts — Tool definitions for the Todo extension
 *
 * Moved from src/tools/todo/tools.ts.
 * Provides `todo_write` and `todo_read` tools.
 */

import { z } from "zod";
import { defineTool } from "@agent-type/defineTool";
import { TODO_WRITE_DESCRIPTION, TODO_READ_DESCRIPTION } from "./prompt";
import { todoItemSchema, todoArraySchema, emptySchema } from "./types";

import type { TodoItem } from "./types";
import { ctxKey } from "@agent-type";

// Re-export schemas and types for convenience
export { todoItemSchema, todoArraySchema, emptySchema };
export type { TodoItem } from "./types";

// ── Tool factories ────────────────────────────────────────────────────────────

export type TodoStore = {
  get: (key: string) => TodoItem[];
  set: (key: string, items: TodoItem[]) => void;
  notify: (key: string) => void;
};

export function createTodoWriteTool(store: TodoStore) {
  return defineTool({
    name: "todo_write",
    group: "Tracking",
    description: TODO_WRITE_DESCRIPTION,
    parameters: z.object({
      todos: todoArraySchema,
    }),
    execute: async ({ todos: newTodos }, context) => {
      const todoKey = ctxKey(context);
      const todos = newTodos as TodoItem[];
      store.set(todoKey, todos);
      store.notify(todoKey);

      const inProgress = todos.filter((t) => t.status === "in-progress");
      if (inProgress.length > 1) {
        return {
          success: false,
          error: `Constraint violation: ${inProgress.length} tasks are "in-progress". Exactly one is allowed. Resubmit with only one in-progress task.`,
        };
      }

      const done = todos.filter((t) => t.status === "completed").length;
      const active = inProgress.length;
      const blocked = todos.filter((t) => t.status === "blocked").length;
      const pending = todos.filter((t) => t.status === "not-started").length;

      return {
        success: true,
        summary: [
          `${done}/${todos.length} completed`,
          active ? `${active} in-progress` : null,
          blocked ? `${blocked} blocked` : null,
          pending ? `${pending} pending` : null,
        ]
          .filter(Boolean)
          .join(", "),
      };
    },
  });
}

export function createTodoReadTool(store: TodoStore) {
  return defineTool({
    name: "todo_read",
    group: "Tracking",
    description: TODO_READ_DESCRIPTION,
    parameters: emptySchema,
    execute: async (_, context) => {
      const todoKey = ctxKey(context);
      const items = store.get(todoKey);
      if (items.length === 0) return { todos: [], message: "No tasks yet." };
      return { todos: items };
    },
  });
}
