/**
 * Sub-Agent CRUD Tool Definitions
 *
 * Tools for creating, updating, listing, and deleting sub-agents.
 *
 * Extracted from `metaTools.ts` — each factory function accepts a dependency
 * bag rather than capturing closure state, making the tools testable in
 * isolation.
 */

import { z } from "zod";
import { defineTool } from '@agent-type/defineTool';
import type { Tool } from '@agent-type';
import type { SubAgentRegistry } from './registryTypes';
import {
  parentFromContext,
  getCallerToolNames,
  buildPoolNames,
} from './subAgentHelpers';

// ── Dependencies ──────────────────────────────────────────────────────────────

export type CrudToolDeps = {
  suffix: string;
  excludedNames: Set<string>;
  getRegistry: (sessionId: string) => SubAgentRegistry;
  getEffectivePool: () => Map<string, Tool>;
  getAgent: () => import('@agent-type').AgentQueryFns;
  /**
   * Optional callback to clean up scrollback cursors scoped to a sub-agent.
   * Called before the agent is deleted from the registry.
   */
  cleanupCursors?: (sessionId: string, subagentName: string) => void;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCrudTools(deps: CrudToolDeps): Tool[] {
  const { suffix, excludedNames, getRegistry, getEffectivePool, getAgent } = deps;

  // ── create_<suffix>_subagent ──────────────────────────────────────────────

  const createSubAgent = defineTool({
    name: `create_${suffix}_subagent`,
    group: "Sub-Agents",
    description: () =>
      `Define a new ${suffix} sub-agent.\n\nAVAILABLE TOOLS:\n` +
      buildPoolNames(getAgent, excludedNames),

    parameters: z.object({
      name: z
        .string()
        .min(1)
        .max(64)
        .regex(/^\S+$/, "Name must not contain whitespace")
        .describe('Unique ID (no spaces), e.g. "researcher"'),
      description: z
        .string()
        .min(20)
        .describe("What this sub-agent specializes in"),
      system_prompt: z
        .string()
        .optional()
        .describe("System prompt / role (omit for general-purpose)"),
      tool_names: z
        .array(z.string())
        .describe("Tool names to grant this sub-agent"),
      max_turns: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(8)
        .describe("Max agentic turns (default 8)"),
    }),

    execute: async (
      { name, description, system_prompt, tool_names, max_turns },
      context,
    ) => {
      const ctx = context;
      const sessionId = ctx.sessionId;
      const parent = parentFromContext(ctx);

      // If the caller is itself a sub-agent, restrict to its own tools.
      const callerTools = getCallerToolNames(
        getRegistry(sessionId).getState,
        sessionId,
        ctx.agentName,
      );
      if (callerTools !== null) {
        const forbidden = tool_names.filter((n) => !callerTools.has(n));
        if (forbidden.length > 0) {
          throw new Error(
            `Cannot grant tools that your sub-agent does not have: [${forbidden.join(", ")}]. ` +
              `Your available tools: [${[...callerTools].join(", ")}].`,
          );
        }
      }

      const conv = getRegistry(sessionId).createSubAgent({
        name,
        description,
        systemPrompt: system_prompt,
        toolNames: tool_names,
        maxTurns: max_turns ?? 8,
        parent,
      });
      const state = conv.getState();
      return {
        created: name,
        conversationId: state.id,
        message:
          `Sub-agent "${name}" created with ${suffix} handler. ` +
          `Tools: [${tool_names.join(", ")}]. maxTurns: ${max_turns ?? 8}. ` +
          `First conversation ID: "${state.id}". ` +
          `Use send_${suffix}_message to start chatting with it.`,
      };
    },
  });

  // ── update_<suffix>_subagent ──────────────────────────────────────────────

  const updateSubAgent = defineTool({
    name: `update_${suffix}_subagent`,
    group: "Sub-Agents",
    description: `Edit an existing ${suffix} sub-agent. Omit fields to keep existing values.`,

    parameters: z.object({
      name: z.string().describe("Name of the sub-agent to update"),
      description: z
        .string()
        .min(20)
        .optional()
        .describe("New description (omit to keep)"),
      system_prompt: z
        .string()
        .optional()
        .describe('New system prompt (omit to keep; pass "" to clear)'),
      tool_names: z
        .array(z.string())
        .optional()
        .describe("New tool list (omit to keep)"),
      max_turns: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe("New maxTurns (omit to keep)"),
    }),

    execute: async (
      { name, description, system_prompt, tool_names, max_turns },
      context,
    ) => {
      const sessionId = context.sessionId;

      // Sub-agents can only assign tools they already have.
      if (tool_names !== undefined) {
        const callerTools = getCallerToolNames(
          getRegistry(sessionId).getState,
          sessionId,
          context.agentName,
        );
        if (callerTools !== null) {
          const forbidden = tool_names.filter((n) => !callerTools.has(n));
          if (forbidden.length > 0) {
            throw new Error(
              `Cannot grant tools that your sub-agent does not have: [${forbidden.join(", ")}]. ` +
                `Your available tools: [${[...callerTools].join(", ")}].`,
            );
          }
        }
      }

      const registry = getRegistry(sessionId);
      registry.updateSubAgent(name, {
        ...(description !== undefined && { description }),
        ...(system_prompt !== undefined && {
          systemPrompt: system_prompt === "" ? undefined : system_prompt,
        }),
        ...(tool_names !== undefined && { toolNames: tool_names }),
        ...(max_turns !== undefined && { maxTurns: max_turns }),
      });
      const snap = registry.getState().subAgents.find((a) => a.name === name);
      return {
        updated: name,
        message: `Sub-agent "${name}" updated. Tools: [${snap?.toolNames.join(", ") ?? ""}]. maxTurns: ${snap?.maxTurns}.`,
      };
    },
  });

  // ── list_<suffix>_subagents ───────────────────────────────────────────────

  const listSubAgents = defineTool({
    name: `list_${suffix}_subagents`,
    group: "Sub-Agents",
    description: `List all ${suffix} sub-agents, conversations, and tool assignments.`,
    parameters: z.object({}),
    execute: async (_, context) => {
      const { subAgents } = getRegistry(context.sessionId).getState();
      if (subAgents.length === 0) {
        return {
          subAgents: [],
          message: `No ${suffix} sub-agents have been created yet.`,
          availableTools: [...getEffectivePool().keys()],
        };
      }
      const summary = subAgents.map((a) => ({
        name: a.name,
        description: a.description,
        toolNames: a.toolNames,
        systemPrompt: a.systemPrompt,
        maxTurns: a.maxTurns,
        parent: a.parent,
        createdAt: a.createdAt,
        activeConversationId: a.activeConversationId,
        conversations: a.conversations.map((c) => ({
          id: c.id,
          title: c.title,
          messages: c.history.length,
          isLoading: c.isLoading,
        })),
      }));
      return { subAgents: summary, count: subAgents.length };
    },
  });

  // ── delete_<suffix>_subagent ──────────────────────────────────────────────

  const deleteSubAgent = defineTool({
    name: `delete_${suffix}_subagent`,
    group: "Sub-Agents",
    description: `Permanently remove a ${suffix} sub-agent and all conversations.`,
    parameters: z.object({
      name: z.string().describe("Name of the sub-agent to delete"),
    }),
    execute: async ({ name }, context) => {
      const { sessionId } = context;
      deps.cleanupCursors?.(sessionId, name);
      getRegistry(sessionId).deleteSubAgent(name);
      return {
        deleted: name,
        message: `Sub-agent "${name}" and all its conversations have been removed.`,
      };
    },
  });

  return [createSubAgent, updateSubAgent, listSubAgents, deleteSubAgent];
}
