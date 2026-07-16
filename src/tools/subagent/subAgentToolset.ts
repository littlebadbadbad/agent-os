/**
 * Sub-Agent Management ToolSet — Main Factory
 *
 * Gives agents the ability to create, update, inspect, and delete sub-agents
 * at runtime, plus have continuous conversations with individual sub-agent
 * conversations — mirroring the terminal/browser tool pattern.
 *
 * Factory: `createSubAgentToolset(suffix, options?)`
 *   suffix   -- short label used in tool names, e.g. 'async' or 'stream'
 *   options.excludeToolNames  -- tool names sub-agents must NOT receive
 *
 * The toolset captures the parent agent reference via the `onAttach` lifecycle
 * hook when registered on an agent.  The handler, tool pool, and registered
 * ToolSets are all resolved lazily at call time from the attached agent.
 *
 * Token tracking and summarisation are handled by whichever ToolSets the
 * parent agent has registered.
 *
 * Returns 9+1 tools (same pattern as terminal/browser):
 *   Sub-agent CRUD (from subAgentCrudTools.ts):
 *     create_<suffix>_subagent     -- define a new sub-agent
 *     update_<suffix>_subagent     -- edit description / tools / maxTurns
 *     list_<suffix>_subagents      -- inspect all sub-agents + conversations
 *     delete_<suffix>_subagent     -- remove a sub-agent and all conversations
 *
 *   Conversation I/O (from subAgentConvTools.ts):
 *     send_<suffix>_message        -- send a message and wait for the response
 *     read_<suffix>_history        -- read conversation messages (with cursor tracking)
 *     create_<suffix>_conversation -- start a new isolated conversation
 *     set_<suffix>_active_conversation -- switch the active conversation
 *     delete_<suffix>_conversation -- remove a conversation
 *
 *   Fire-and-forget (from delegateTool.ts):
 *     delegate_<suffix>_task       -- ephemeral sub-agent, returns result, self-destructs
 *
 * Also returns `getRegistry(sessionId)` for per-session programmatic / UI access.
 */

import { createSubAgentRegistry } from "./registry";
import { createCrudTools } from "./subAgentCrudTools";
import { createConvTools } from "./subAgentConvTools";
import { createDelegateTaskTool } from "./delegateTool";
import { parentFromContext } from "./subAgentHelpers";
import { SUBAGENT_SECTION_ID, SUBAGENT_DECISION_FRAMEWORK } from "./prompt";
import type { Tool, ToolSet, ToolSetContext, AgentQueryFns, AgentHandler } from '@agent-type';
import type { SubAgentRegistry, SubAgentSerializedEntry } from "./registryTypes";
import type { SessionEntryData } from "../../client/sessionManager.types";

// ── Module augmentation ───────────────────────────────────────────────────────

declare module '@agent-type' {
  interface SessionEntryExtension {
    subAgents?: SubAgentSerializedEntry[];
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSubAgentToolset(
  suffix: string,
  options?: {
    excludeToolNames?: readonly string[];
    withVariables?: boolean;
    handler?: AgentHandler;
  },
) {
  const withVariables = options?.withVariables ?? false;
  const excludedNames = new Set(options?.excludeToolNames ?? []);

  // ── Closure state ──────────────────────────────────────────────────────────

  /** Attached agent function refs — populated via onAttach. */
  let agentFns: AgentQueryFns | null = null;

  function getAgent(): AgentQueryFns {
    if (!agentFns)
      throw new Error(
        `[subagent-${suffix}] ToolSet used before being attached to an agent.`,
      );
    return agentFns;
  }

  /**
   * Pool for AI-facing descriptions: respects ToolState filtering so the
   * model only sees currently-enabled tools in the "available tools" list.
   */
  function getEffectivePool(): Map<string, Tool> {
    const agent = getAgent();
    const allTools = agent.getFilteredTools();
    const pool = new Map<string, Tool>();
    for (const tool of allTools) {
      if (!excludedNames.has(tool.name)) {
        pool.set(tool.name, tool);
      }
    }
    return pool;
  }

  /**
   * Pool for runtime tool resolution: always uses the complete unfiltered
   * tool list so that sub-agents whose `toolNames` include a tool that is
   * currently disabled at the main-agent scope can still execute correctly.
   */
  function getFullPool(): Map<string, Tool> {
    const pool = new Map<string, Tool>();
    for (const tool of getAgent().getTools()) {
      if (!excludedNames.has(tool.name)) {
        pool.set(tool.name, tool);
      }
    }
    return pool;
  }

  // ── Per-session registry map ──────────────────────────────────────────────

  const sessionRegistries = new Map<string, SubAgentRegistry>();

  function getRegistry(sessionId: string): SubAgentRegistry {
    let reg = sessionRegistries.get(sessionId);
    if (!reg) {
      reg = createSubAgentRegistry({
        sessionId,
        label: suffix,
        toolPool: getFullPool,
        handler: options?.handler ?? getAgent().handler,
        getToolSets: () =>
          getAgent()
            .getRegisteredToolSets()
            .filter((ts) => !ts.name.startsWith("subagent-")),
      });
      sessionRegistries.set(sessionId, reg);
    }
    return reg;
  }

  // ── Scrollback cursors — shared between Conv tools and lifecycle hooks ────

  const scrollbackCursors = new Map<string, number>();

  /** Clean up scrollback cursors scoped to a specific sub-agent. */
  function cleanupAgentCursors(sessionId: string, agentName: string): void {
    const prefix = `${sessionId}:${agentName}:`;
    for (const key of scrollbackCursors.keys()) {
      if (key.startsWith(prefix)) scrollbackCursors.delete(key);
    }
  }

  // ── Build tools from sub-modules ──────────────────────────────────────────

  const crudTools = createCrudTools({
    suffix,
    excludedNames,
    getRegistry,
    getEffectivePool,
    getAgent,
    cleanupCursors: cleanupAgentCursors,
  });

  const convTools = createConvTools({
    suffix,
    withVariables,
    getRegistry,
    scrollbackCursors,
  });

  const delegateTask = createDelegateTaskTool(suffix, {
    getRegistry,
    getEffectivePool,
  });

  const allTools = [...crudTools, ...convTools, delegateTask];

  // ── ToolSet definition ───────────────────────────────────────────────────

  const base = {
    name: `subagent-${suffix}`,
    coreTools: [
      `create_${suffix}_subagent`,
      `send_${suffix}_message`,
      `delegate_${suffix}_task`,
    ],
    sectionId: SUBAGENT_SECTION_ID,
    sectionPriority: 30,
    tools: allTools,

    // ── Lifecycle hooks ────────────────────────────────────────────────

    onAttach(agent: AgentQueryFns): void {
      agentFns = agent;
    },

    onGetState: (ctx: ToolSetContext) => ({
      subAgentRegistry: getRegistry(ctx.sessionId),
    }),

    onSubscribe: (ctx: ToolSetContext, fn: () => void) =>
      getRegistry(ctx.sessionId).subscribe(fn),

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      if (entryData && entryData.subAgents?.length) {
        getRegistry(ctx.sessionId).loadSnapshot(entryData.subAgents);
      }
    },

    onReset(ctx: ToolSetContext): void {
      // Clear cursor state and drop all sub-agents.
      for (const key of [...scrollbackCursors.keys()]) {
        if (key.startsWith(`${ctx.sessionId}:`)) scrollbackCursors.delete(key);
      }
      getRegistry(ctx.sessionId).loadSnapshot([]);
    },

    onRemove(ctx: ToolSetContext): void {
      // Clean up all cursor state scoped to this session.
      for (const key of [...scrollbackCursors.keys()]) {
        if (key.startsWith(`${ctx.sessionId}:`)) scrollbackCursors.delete(key);
      }
      sessionRegistries.delete(ctx.sessionId);
    },

    onBuildSnapshot(ctx: ToolSetContext) {
      const snap = getRegistry(ctx.sessionId).getSnapshot();
      return snap.length > 0 ? { subAgents: snap } : {};
    },

    onGetSystemPrompt(): string {
      return SUBAGENT_DECISION_FRAMEWORK;
    },
  } satisfies ToolSet;

  // ── Named references (preserve camelCase names matching old metaTools.ts) ─

  const [createSubAgent, updateSubAgent, listSubAgents, deleteSubAgent] = crudTools;
  const [sendMessage, readHistory, createConversation, setActiveConversation, deleteConversation] = convTools;

  // ── Return ─────────────────────────────────────────────────────────────

  return {
    ...base,
    createSubAgent,
    updateSubAgent,
    listSubAgents,
    deleteSubAgent,
    sendMessage,
    readHistory,
    createConversation,
    setActiveConversation,
    deleteConversation,
    delegateTask,
    // Per-session registry — for programmatic access and testing.
    getRegistry,
  };
}
