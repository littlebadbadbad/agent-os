/**
 * Delegate Task Tool
 *
 * Creates an ephemeral sub-agent, sends a task, awaits the result, then
 * destroys the sub-agent automatically.  Unlike the full sub-agent meta-tools
 * (create / send / delete), this is fire-and-forget: the calling agent never
 * sees the intermediate tool calls, only the final answer.
 *
 * Use when the calling agent will NOT need the raw intermediate outputs in its
 * own context — only the final summary/result.
 */

import { z } from "zod";
import { defineTool } from '@agent-type/defineTool';
import type { Tool } from '@agent-type';
import type { SubAgentRegistry } from "./registryTypes";
import { DELEGATE_TASK_DESCRIPTION } from "./prompt";

// ── Counter for unique ephemeral agent names ──────────────────────────────────

let delegateCounter = 0;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the `delegate_<suffix>_task` tool.
 *
 * @param suffix  - Same suffix as the parent subagent ToolSet (e.g. 'async', 'stream').
 * @param deps    - Closure references from `createSubAgentToolset`.
 */
export function createDelegateTaskTool(
  suffix: string,
  deps: {
    /** Returns the per-session registry (creates one on first call). */
    getRegistry: (sessionId: string) => SubAgentRegistry;
    /**
     * Returns the current filtered tool pool from the parent agent.
     * The delegate sub-agent receives all these tools minus the delegate tool
     * itself (to prevent infinite recursion).
     */
    getEffectivePool: () => Map<string, Tool>;
  },
): Tool {
  const delegateToolName = `delegate_${suffix}_task`;

  return defineTool({
    name: delegateToolName,
    group: "Sub-Agents",
    description: DELEGATE_TASK_DESCRIPTION,

    parameters: z.object({
      task: z
        .string()
        .min(1)
        .describe("The self-contained task: goal, expected output, constraints"),
      context: z
        .string()
        .optional()
        .describe("Background knowledge (omit if task is self-contained)"),
      max_turns: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(10)
        .optional()
        .describe("Max agentic turns (default 10)"),
    }),

    execute: async ({ task, context, max_turns }, execContext) => {
      const { sessionId, signal } = execContext;
      const registry = deps.getRegistry(sessionId);

      // Build a unique ephemeral name
      const agentName = `__delegate_${suffix}_${++delegateCounter}`;

      // Give the sub-agent all currently-available tools except the delegate
      // tool itself (prevents infinite recursion).
      const pool = deps.getEffectivePool();
      const toolNames = [...pool.keys()].filter((n) => n !== delegateToolName);

      // Compose the message (task + optional context block)
      const message = context
        ? `${task}\n\n---\nContext (what is already known):\n${context}`
        : task;

      // Create the ephemeral sub-agent
      const conv = registry.createSubAgent({
        name: agentName,
        description: `Ephemeral delegate: ${task.slice(0, 80)}${task.length > 80 ? "…" : ""}`,
        toolNames,
        maxTurns: max_turns ?? 10,
        parent: `${execContext.agentName}:${execContext.conversationId}`,
      });

      const conversationId = conv.getState().id;

      try {
        const result = await registry.sendMessage(
          agentName,
          conversationId,
          message,
          { sessionId, signal },
        );

        return {
          result: result.output,
          turns: result.turns,
          tool_calls: result.toolCallCount,
        };
      } finally {
        // Best-effort cleanup — ignore errors if the agent was already removed
        try {
          registry.deleteSubAgent(agentName);
        } catch {
          // ignore
        }
      }
    },
  });
}
