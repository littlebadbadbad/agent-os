/**
 * Types for the task-tracking ToolSet.
 *
 * @module
 */

export type TodoItem = import('zod').z.infer<typeof import('./tools').todoItemSchema>;
export type TodoStatus = 'not-started' | 'in-progress' | 'completed' | 'blocked';
export type TodoPriority = 'low' | 'medium' | 'high';
