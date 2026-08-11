/**
 * internal-apps/todo/agent/activate.ts — Todo app activation entry
 *
 * This is the app's agent-side entry point, loaded by the app runtime
 * when the todo extension is activated.
 *
 * The app receives an AgentAppHost and registers its ToolSet.
 */

import type { AgentAppHost, ToolSet, SlotDeclaration } from '@agent-type';
import { createTodoTools } from './toolSet';

/**
 * Activate the todo app.
 *
 * Builds the todo ToolSet and registers it on the agent.
 *
 * @param host  The AgentAppHost for this app.
 */
export function activate(host: AgentAppHost): void {
  const toolSet = createTodoTools() as ToolSet & { readonly todoSlotDeclarations: readonly SlotDeclaration[] };
  host.registerToolSet(toolSet, toolSet.todoSlotDeclarations);
}
