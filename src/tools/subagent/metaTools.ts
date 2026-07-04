/**
 * Sub-Agent Management ToolSet
 *
 * Gives agents the ability to create, update, inspect, and delete sub-agents
 * at runtime, plus have continuous conversations with individual sub-agent
 * conversations -- mirroring the terminal/browser tool pattern.
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
 * parent agent has registered (e.g. `createTokenBudgetToolSet`).
 *
 * Returns 9 tools (same pattern as terminal/browser):
 *   Sub-agent CRUD:
 *     create_<suffix>_subagent        -- define a new sub-agent
 *     update_<suffix>_subagent        -- edit description / tools / maxTurns
 *     list_<suffix>_subagents         -- inspect all sub-agents + conversations
 *     delete_<suffix>_subagent        -- remove a sub-agent and all conversations
 *
 *   Conversation I/O (terminal-style):
 *     send_<suffix>_message           -- send a message and wait for the response
 *     read_<suffix>_history           -- read conversation messages (with cursor tracking)
 *     create_<suffix>_conversation    -- start a new isolated conversation
 *     set_<suffix>_active_conversation -- switch the active conversation
 *     delete_<suffix>_conversation    -- remove a conversation
 *
 * Also returns `getRegistry(sessionId)` for per-session programmatic / UI access.
 */

import { z } from "zod";
import { defineTool } from '@agent-type/defineTool';
import { createSubAgentRegistry } from "./registry";
import type { Tool, ToolExecutionContext } from '@agent-type';
import type { Attachment } from '@agent-type';
import { isDataAttachment, isUrlAttachment } from "../messages/attachment";
import type {
  ToolSet,
  ToolSetContext,
  AgentClientLike,
  AgentQueryFns,
} from "@agent-type";
import type { SubAgentRegistry, SubAgentSerializedEntry } from "./registryTypes";
import type { SessionEntryData } from "../../client/sessionManager.types";
import type { AgentHandler } from '@agent-type';
import { SUBAGENT_SECTION_ID, SUBAGENT_DECISION_FRAMEWORK } from "./prompt";
import { createDelegateTaskTool } from "./delegateTool";

// ── Module augmentation ───────────────────────────────────────────────────────

declare module '@agent-type' {
  interface SessionEntryExtension {
    /**
     * Sub-agent definitions and conversation history to restore.
     * Populated by the sub-agent ToolSet via `onInitSession` / `onBuildSnapshot`.
     */
    subAgents?: SubAgentSerializedEntry[];
  }
}

// -- Factory -------------------------------------------------------------------

export function createSubAgentToolset(
  suffix: string,
  options?: {
    /**
     * Tool names that sub-agents must NOT receive.
     * Meta-tools (create_/update_/list_/delete_/send_/read_/etc.) are included
     * in the pool by default so that sub-agents can themselves create sub-agents.
     * Pass their names here to explicitly prevent that.
     */
    excludeToolNames?: readonly string[];
    /**
     * Set to `true` when the variable ToolSet (`createVariableToolSet`) is
     * installed on the parent agent.
     *
     * When `true`, the `send_*_message` tool exposes an `attachment_handles`
     * parameter whose description explains how to forward `$var:xxxxxxxx`
     * attachment handles to sub-agents.  Handles are resolved directly from
     * the per-session variable store — no extra wiring needed.
     *
     * When `false` (default), the parameter is still accepted but neither the
     * tool description nor the parameter description mention variables, and
     * any passed handles are silently ignored.
     */
    withVariables?: boolean;
    /**
     * Custom message handler for sub-agent turns.
     * Defaults to the attached parent agent's own handler.
     */
    handler?: AgentHandler;
  },
) {
  const withVariables = options?.withVariables ?? false;

  // -- Attached agent fn refs -----------------------------------------------
  // Populated via onAttach when the toolset is registered on an agent.
  // Stored as individual function refs rather than the full agent so callers
  // only need to provide the methods that are actually used (AgentQueryFns).
  let agentFns: AgentQueryFns | null = null;

  function getAgent(): AgentQueryFns {
    if (!agentFns)
      throw new Error(
        `[subagent-${suffix}] ToolSet used before being attached to an agent.`,
      );
    return agentFns;
  }

  // -- Build the effective tool pool -----------------------------------------

  const excludedNames = new Set(options?.excludeToolNames ?? []);

  /**
   * Pool for AI-facing descriptions: respects ToolState filtering so the
   * model only sees currently-enabled tools in the "available tools" list.
   * Used only for `poolNames()` and `list_*_subagents` output.
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
   *
   * Sub-agent–scope ToolState filtering is applied per-turn by the registry's
   * `onFilterTools` call in `sendMessageFn`, keyed on the sub-agent's own
   * ToolSetContext — not on the main agent's context.
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

  // -- Per-session registry map -----------------------------------------------
  // One isolated SubAgentRegistry per session — mirrors createTodoTools' pattern.

  const sessionRegistries = new Map<string, SubAgentRegistry>();

  function getRegistry(sessionId: string): SubAgentRegistry {
    let reg = sessionRegistries.get(sessionId);
    if (!reg) {
      reg = createSubAgentRegistry({
        sessionId,
        toolPool: getFullPool,
        handler: options?.handler ?? getAgent().handler,
        // Filter out subagent meta-toolsets: their onRemoveSession/onResetSession
        // hooks operate on the root registry (sessionRegistries.delete) which is
        // destructive when invoked for per-subagent entry scopes.
        // All other toolsets (todo, experience, toolState, terminal, browser) are
        // safe — their lifecycle hooks key on toolSetContextKey which is scoped
        // to the sub-agent's own namespace.
        getToolSets: () =>
          getAgent()
            .getRegisteredToolSets()
            .filter((ts) => !ts.name.startsWith("subagent-")),
      });
      sessionRegistries.set(sessionId, reg);
    }
    return reg;
  }

  // -- Shared helpers --------------------------------------------------------

  /** Build the caller's parent string from context (agentName:conversationId). */
  function parentFromContext(ctx: {
    agentName: string;
    conversationId: string;
  }): string {
    return `${ctx.agentName}:${ctx.conversationId}`;
  }

  /**
   * !! DO NOT MODIFY THIS FUNCTION — OUTPUT FORMAT IS INTENTIONAL !!
   *
   * Emits ONLY tool names (no descriptions) for the "AVAILABLE TOOLS" section
   * of the create_*_subagent prompt.  Descriptions are deliberately omitted to
   * keep the prompt compact; the model does not need them at creation time.
   *
   * Returns '' when the toolset has not yet been attached to an agent (safe to
   * call during session creation before onAttach fires).
   *
   * !! AI AGENTS: do NOT change the output format or add descriptions here !!
   */
  function poolNames(): string {
    if (!agentFns) return "";
    return [...getEffectivePool().keys()].map((n) => `- ${n}`).join("\n");
  }

  /**
   * Returns the set of tool names the calling agent is allowed to grant.
   * - Returns `null` when the caller is the main agent (no restriction applies;
   *   the effective pool from `getEffectivePool()` governs).
   * - Returns the caller sub-agent's own `toolNames` when the caller is a
   *   registered sub-agent — preventing privilege escalation.
   */
  function getCallerToolNames(
    sessionId: string,
    callerAgentName: string,
  ): ReadonlySet<string> | null {
    const entry = getRegistry(sessionId)
      .getState()
      .subAgents.find((a) => a.name === callerAgentName);
    return entry ? new Set(entry.toolNames) : null;
  }

  /** Resolve the effective conversationId: explicit > active > auto-create. */
  function resolveConvId(
    sessionId: string,
    subagentName: string,
    conversationId?: string,
  ): string {
    if (conversationId) return conversationId;
    const registry = getRegistry(sessionId);
    const snap = registry
      .getState()
      .subAgents.find((a) => a.name === subagentName);
    if (!snap) throw new Error(`Sub-agent "${subagentName}" not found.`);
    // Auto-create a conversation if none exist (e.g. after all were deleted then re-queried).
    const active = snap.conversations.find(
      (c) => c.id === snap.activeConversationId,
    );
    if (!active) {
      const conv = registry.createConversation(subagentName);
      return conv.getState().id;
    }
    return snap.activeConversationId;
  }

  // -- Per-tool read cursor for read_<suffix>_history ------------------------
  // Mirrors terminal_read's auto-advancing offset.
  // Keyed by "${sessionId}:${subagent_name}:${convId}" for proper session isolation.
  const historyReadCursors = new Map<string, number>();

  // -- create_<suffix>_subagent ----------------------------------------------

  const createSubAgent = defineTool({
    name: `create_${suffix}_subagent`,
    group: "Sub-Agents",
    description: () =>
      `Define a new ${suffix} sub-agent with a focused tool set and system prompt. Returns the agent name and first conversation id.\n\n` +
      `AVAILABLE TOOLS:\n` +
      poolNames(),

    parameters: z.object({
      name: z
        .string()
        .min(1)
        .max(64)
        .regex(/^\S+$/, "Name must not contain whitespace")
        .describe(
          'Unique name for this sub-agent, e.g. "researcher", "file_processor", "coder-v2"',
        ),
      description: z
        .string()
        .min(20)
        .describe(
          "Describes this sub-agent's specialisation. Shown in list_subagents for reference.",
        ),
      system_prompt: z
        .string()
        .optional()
        .describe(
          "Role/persona injected into every call this sub-agent makes. " +
            'Example: "You are an expert TypeScript developer. Be concise." ' +
            "Omit for a general-purpose sub-agent.",
        ),
      tool_names: z
        .array(z.string())
        .describe(
          `Tool names from the available pool to give this sub-agent access to.`,
        ),
      max_turns: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(8)
        .describe("Maximum agentic turns (handler invocations). Default: 8."),
    }),

    execute: async (
      { name, description, system_prompt, tool_names, max_turns },
      context,
    ) => {
      const ctx = context;
      const sessionId = ctx.sessionId;
      const parent = parentFromContext(ctx);

      // If the caller is itself a sub-agent, restrict to its own tools.
      const callerTools = getCallerToolNames(sessionId, ctx.agentName);
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

  // -- update_<suffix>_subagent ----------------------------------------------

  const updateSubAgent = defineTool({
    name: `update_${suffix}_subagent`,
    group: "Sub-Agents",
    description:
      `Edit an existing ${suffix} sub-agent's definition. ` +
      `Omit any field to keep the existing value -- only supplied fields are overwritten. ` +
      `Changes take effect immediately on the next message sent to the sub-agent.`,

    parameters: z.object({
      name: z.string().describe("Exact name of the sub-agent to update"),
      description: z
        .string()
        .min(20)
        .optional()
        .describe("New description (omit to keep existing)"),
      system_prompt: z
        .string()
        .optional()
        .describe('New system prompt (omit to keep; pass "" to clear)'),
      tool_names: z
        .array(z.string())
        .optional()
        .describe("New tool list (omit to keep existing)"),
      max_turns: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe("New maxTurns (omit to keep existing)"),
    }),

    execute: async (
      { name, description, system_prompt, tool_names, max_turns },
      context,
    ) => {
      const ctx = context as ToolExecutionContext;
      const sessionId = ctx.sessionId;

      // Sub-agents can only assign tools they already have.
      if (tool_names !== undefined) {
        const callerTools = getCallerToolNames(sessionId, ctx.agentName);
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
      const snap = registry.getState().subAgents.find((a) => a.name === name)!;
      return {
        updated: name,
        message: `Sub-agent "${name}" updated. Tools: [${snap.toolNames.join(", ")}]. maxTurns: ${snap.maxTurns}.`,
      };
    },
  });

  // -- list_<suffix>_subagents -----------------------------------------------

  const listSubAgents = defineTool({
    name: `list_${suffix}_subagents`,
    group: "Sub-Agents",
    description:
      `List all ${suffix} sub-agents with their conversations, tools, maxTurns, and token usage. ` +
      `Each sub-agent shows its active conversation ID and all conversation IDs. ` +
      `Use conversation IDs with send_${suffix}_message and read_${suffix}_history.`,
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

  // -- delete_<suffix>_subagent ----------------------------------------------

  const deleteSubAgent = defineTool({
    name: `delete_${suffix}_subagent`,
    group: "Sub-Agents",
    description:
      `Permanently remove a ${suffix} sub-agent and all its conversations. ` +
      `All conversation history is lost.`,
    parameters: z.object({
      name: z.string().describe("Exact name of the sub-agent to delete"),
    }),
    execute: async ({ name }, context) => {
      const { sessionId } = context;
      // Purge all cursor entries scoped to this sub-agent before deleting it,
      // so the historyReadCursors map doesn't accumulate stale entries.
      const cursorPrefix = `${sessionId}:${name}:`;
      for (const key of historyReadCursors.keys()) {
        if (key.startsWith(cursorPrefix)) historyReadCursors.delete(key);
      }
      getRegistry(sessionId).deleteSubAgent(name);
      return {
        deleted: name,
        message: `Sub-agent "${name}" and all its conversations have been removed.`,
      };
    },
  });

  // -- send_<suffix>_message -------------------------------------------------

  const sendMessage = defineTool({
    name: `send_${suffix}_message`,
    group: "Sub-Agents",
    description:
      `Send a message to a ${suffix} sub-agent and wait for its response. ` +
      `The sub-agent runs its full agent loop (may call tools internally) and returns the final text. ` +
      `Conversation history is automatically preserved -- each call continues from where the last left off. ` +
      `Omit \`conversation_id\` to target the active conversation. ` +
      `Pass an explicit \`conversation_id\` to target a specific conversation (see list_${suffix}_subagents). ` +
      `Use read_${suffix}_history to review prior messages in the conversation.` +
      (withVariables
        ? ` Pass \`attachment_handles\` to forward images or documents stored as variables to the sub-agent.`
        : ""),
    parameters: z.object({
      subagent_name: z
        .string()
        .describe("Exact name of the sub-agent to message"),
      message: z
        .string()
        .min(1)
        .describe(
          "The message to send. The sub-agent will reply and the response is returned.",
        ),
      conversation_id: z
        .string()
        .optional()
        .describe("Target conversation (omit to use the active conversation)"),
      attachment_handles: z
        .array(z.unknown())
        .optional()
        .describe(
          withVariables
            ? "Variable handles ($var:xxxxxxxx) pointing to images or documents in the variable store. " +
                "Resolved attachments are embedded in the opening user turn so the sub-agent can see them. " +
                "Note: the variable ToolSet's onResolveToolArgs hook resolves handle strings to Attachment " +
                "objects before this execute function is called."
            : "Requires the variable ToolSet. Leave empty if variables are not in use.",
        ),
    }),
    execute: async (
      { subagent_name, message, conversation_id, attachment_handles },
      context,
    ) => {
      const { sessionId, signal } = context;
      const registry = getRegistry(sessionId);
      const convId = resolveConvId(sessionId, subagent_name, conversation_id);
      // By the time execute runs, the variable ToolSet's onResolveToolArgs hook
      // has already resolved any "$var:xxxxxxxx" handle strings to their backing
      // Attachment objects.  Filter to only valid Attachment shapes so stray
      // non-resolved values (e.g. when the variable ToolSet is absent) are dropped.
      const attachments = attachment_handles?.filter(
        (h): h is Attachment =>
          isDataAttachment(h as Attachment) || isUrlAttachment(h as Attachment),
      );
      const result = await registry.sendMessage(
        subagent_name,
        convId,
        message,
        {
          sessionId,
          signal,
          ...(attachments?.length && { attachments }),
        },
      );
      const conv = registry.getConversation(subagent_name, convId);
      return {
        response: result.output,
        turns: result.turns,
        toolCallCount: result.toolCallCount,
        conversationId: convId,
        messageCount: conv?.getHistory().length ?? 0,
      };
    },
  });

  // -- read_<suffix>_history -------------------------------------------------

  const readHistory = defineTool({
    name: `read_${suffix}_history`,
    group: "Sub-Agents",
    description:
      `Read the conversation history from a ${suffix} sub-agent conversation. ` +
      `Each message carries a stable \`index\` for pagination. ` +
      `Omit \`from_index\` to auto-continue from where the last read left off (like terminal_read). ` +
      `Pass \`from_index: 0\` to re-read from the beginning of the conversation. ` +
      `Omit \`conversation_id\` to read the active conversation.`,
    parameters: z.object({
      subagent_name: z.string().describe("Exact name of the sub-agent"),
      conversation_id: z
        .string()
        .optional()
        .describe("Target conversation (omit for active)"),
      from_index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Start from this message index. Omit to auto-continue from last read position. Pass 0 to read from the beginning.",
        ),
      max_messages: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Maximum messages to return (default: all from from_index)"),
    }),
    execute: async (
      { subagent_name, conversation_id, from_index, max_messages },
      context,
    ) => {
      const { sessionId } = context;
      const convId = resolveConvId(sessionId, subagent_name, conversation_id);
      const cursorKey = `${sessionId}:${subagent_name}:${convId}`;
      const effectiveFrom =
        from_index ?? historyReadCursors.get(cursorKey) ?? 0;
      const messages = getRegistry(sessionId).readHistory(
        subagent_name,
        convId,
        effectiveFrom,
        max_messages,
      );
      const nextCursor =
        messages.length > 0
          ? messages[messages.length - 1].index + 1
          : effectiveFrom;
      historyReadCursors.set(cursorKey, nextCursor);
      return {
        subAgent: subagent_name,
        conversationId: convId,
        messages,
        from: effectiveFrom,
        next: nextCursor,
        totalFetched: messages.length,
      };
    },
  });

  // -- create_<suffix>_conversation ------------------------------------------

  const createConversation = defineTool({
    name: `create_${suffix}_conversation`,
    group: "Sub-Agents",
    description:
      `Create a new conversation for a ${suffix} sub-agent. ` +
      `The new conversation becomes the active one immediately. ` +
      `Each conversation has its own isolated message history and todo list. ` +
      `Use this to start a fresh thread without discarding the previous one.`,
    parameters: z.object({
      subagent_name: z.string().describe("Exact name of the sub-agent"),
      title: z
        .string()
        .optional()
        .describe("Human-readable title. Auto-generated if omitted."),
    }),
    execute: async ({ subagent_name, title }, context) => {
      const conv = getRegistry(context.sessionId).createConversation(
        subagent_name,
        { title },
      );
      const state = conv.getState();
      return {
        created: state.id,
        subAgent: subagent_name,
        title: state.title,
        message:
          `Conversation "${state.title}" (id: ${state.id}) created for "${subagent_name}" and set as active. ` +
          `Use send_${suffix}_message with this conversation_id to start chatting.`,
      };
    },
  });

  // -- delete_<suffix>_conversation ------------------------------------------

  const deleteConversation = defineTool({
    name: `delete_${suffix}_conversation`,
    group: "Sub-Agents",
    description:
      `Delete a specific conversation from a ${suffix} sub-agent. ` +
      `If the deleted conversation was active, the nearest remaining one becomes active. ` +
      `If it was the last conversation, a new empty one is created automatically.`,
    parameters: z.object({
      subagent_name: z.string().describe("Exact name of the sub-agent"),
      conversation_id: z.string().describe("ID of the conversation to delete"),
    }),
    execute: async ({ subagent_name, conversation_id }, context) => {
      const { sessionId } = context;
      // Purge the cursor entry for this conversation before deleting it.
      historyReadCursors.delete(
        `${sessionId}:${subagent_name}:${conversation_id}`,
      );
      getRegistry(sessionId).deleteConversation(subagent_name, conversation_id);
      return {
        deleted: conversation_id,
        subAgent: subagent_name,
        message: `Conversation "${conversation_id}" deleted from sub-agent "${subagent_name}".`,
      };
    },
  });

  const setActiveConversation = defineTool({
    name: `set_${suffix}_active_conversation`,
    group: "Sub-Agents",
    description:
      `Switch the active conversation for a ${suffix} sub-agent. ` +
      `Subsequent calls to \`send_${suffix}_message\` without a \`conversation_id\` ` +
      `will target the newly activated conversation. ` +
      `Use \`list_${suffix}_subagents\` to see all available conversation IDs.`,
    parameters: z.object({
      subagent_name: z.string().describe("Exact name of the sub-agent"),
      conversation_id: z
        .string()
        .describe("ID of the conversation to make active"),
    }),
    execute: async ({ subagent_name, conversation_id }, context) => {
      getRegistry(context.sessionId).setActiveConversation(
        subagent_name,
        conversation_id,
      );
      return {
        active: conversation_id,
        subAgent: subagent_name,
        message:
          `Conversation "${conversation_id}" is now active for "${subagent_name}". ` +
          `send_${suffix}_message will target this conversation unless you pass an explicit conversation_id.`,
      };
    },
  });

  // -- Delegate task tool (ephemeral fire-and-forget sub-agent) ---------------
  const delegateTask = createDelegateTaskTool(suffix, { getRegistry, getEffectivePool });

  // -- Return ----------------------------------------------------------------
  // The ToolSet-required shape is validated at declaration time via `satisfies`.
  // The returned object is a superset: it also exposes named tool references and
  // `getRegistry` for programmatic / test access without losing type specificity.

  const base = {
    name: `subagent-${suffix}`,
    coreTools: [`create_${suffix}_subagent`, `send_${suffix}_message`, `delegate_${suffix}_task`],
    sectionId: SUBAGENT_SECTION_ID,
    sectionPriority: 30,
    tools: [
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
    ],

    // ── ToolSet lifecycle hooks ────────────────────────────────────────────
    onAttach(agent: AgentQueryFns): void {
      agentFns = agent;
    },
    onGetState: (ctx: ToolSetContext) => ({
      subAgentRegistries: [getRegistry(ctx.sessionId)],
    }),
    onSubscribe: (ctx: ToolSetContext, fn: () => void) =>
      getRegistry(ctx.sessionId).subscribe(fn),
    onInitSession(ctx: ToolSetContext, entryData: SessionEntryData): void {
      if (entryData.subAgents?.length) {
        getRegistry(ctx.sessionId).loadSnapshot(entryData.subAgents);
      }
    },
    onResetSession(ctx: ToolSetContext): void {
      // Clear cursor state and drop all sub-agents — history-clear should not
      // preserve sub-agents created during the cleared conversation.
      for (const key of [...historyReadCursors.keys()]) {
        if (key.startsWith(`${ctx.sessionId}:`)) historyReadCursors.delete(key);
      }
      getRegistry(ctx.sessionId).loadSnapshot([]);
    },
    onRemoveSession(ctx: ToolSetContext): void {
      // Clean up all cursor state scoped to this session.
      for (const key of [...historyReadCursors.keys()]) {
        if (key.startsWith(`${ctx.sessionId}:`)) historyReadCursors.delete(key);
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

  return {
    ...base,
    // Named tool references for type-safe programmatic / test access.
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
