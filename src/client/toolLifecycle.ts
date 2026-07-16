import { resolveToolSetTools, type AnyRecord, type Tool } from '@agent-type';
import { MAIN_CONVERSATION_ID } from '@agent-sdk/tools/toolSet';
import type { ToolSet, ToolSetContext, AgentClientLike } from '@agent-type';
import type { ToolManager } from './toolManager';
import type { SessionManager } from './sessionManager.types';

export type ToolLifecycleDeps = {
  masterTools: Tool[];
  masterToolSets: ToolSet[];
  slots: Map<string, ToolManager>;
  sessionMgr: Pick<SessionManager, 'getState'>;
  /** Lazy getter for all active ToolSets (config-time + runtime-registered). */
  getAllToolSets: () => readonly ToolSet[];
  /** The agent's configured `id` (or `'main'` fallback). Used to build ToolSetContext. */
  agentId: string;
  /** Lazy getter for the owning AgentClient, used to fire `onAttach`. */
  getAgentClient: () => AgentClientLike;
};

export function createToolLifecycle(deps: ToolLifecycleDeps) {
  const { masterTools, masterToolSets, slots, sessionMgr, getAllToolSets, agentId, getAgentClient } = deps;

  /** Build a main-agent ToolSetContext for a given sessionId. */
  function makeCtx(sessionId: string): ToolSetContext {
    return { sessionId, agentName: agentId, conversationId: MAIN_CONVERSATION_ID };
  }

  return {
    getTools(): Tool[] {
      return [...masterTools];
    },

    /**
     * Returns tools after applying every ToolSet's `onFilterTools` hook for
     * the currently active session.  Falls back to all master tools when no
     * session is active or no ToolSet filters are registered.
     *
     * Used by sub-agent meta-tools to build the "available tools" description
     * for the AI (IP4).
     */
    getFilteredTools(): readonly Tool[] {
      const activeId = sessionMgr.getState().activeSessionId;
      let tools: readonly Tool[] = [...masterTools];
      if (activeId) {
        const tm = slots.get(activeId);
        if (tm) tools = tm.getTools();
      }
      const ctx = makeCtx(activeId ?? '');
      for (const ts of getAllToolSets()) {
        if (ts.onFilterTools) tools = ts.onFilterTools(ctx, tools);
      }
      return tools;
    },

    registerTool<T extends Tool>(tool: T): () => void {
      masterTools.push(tool);
      for (const tm of slots.values()) {
        tm.registerTool(tool);
      }
      return () => {
        const idx = masterTools.indexOf(tool);
        if (idx !== -1) masterTools.splice(idx, 1);
        for (const tm of slots.values()) {
          tm.unregisterByName(tool.name);
        }
      };
    },
    registerTools<T extends Tool>(tools: readonly T[]): () => void {
      for (const tool of tools) {
        masterTools.push(tool);
        for (const tm of slots.values()) {
          tm.registerTool(tool);
        }
      }
      return () => {
        for (const tool of tools) {
          const idx = masterTools.indexOf(tool);  
          if (idx !== -1) masterTools.splice(idx, 1);
          for (const tm of slots.values()) {
            tm.unregisterByName(tool.name);
          }
        }
      };
    },

    registerToolSet(ts: ToolSet): () => void {
      masterToolSets.push(ts);
      const tools = resolveToolSetTools(ts);
      for (const tool of tools) {
        masterTools.push(tool);
      }

      // Fire onAttach before initialising existing sessions so any tools
      // injected via registerTool/registerToolSet inside onAttach (e.g. proxy
      // or proxy tools) are present when onInitSession runs.
      const detach = ts.onAttach?.(getAgentClient());

      // Per-session unsubscribe functions returned by ts.onSubscribe.
      // Keyed by sessionId so we can tear each one down precisely on deregister.
      const sessionUnsubs = new Map<string, () => void>();

      for (const [sessionId, tm] of slots) {
        const ctx = makeCtx(sessionId);
        for (const tool of tools) {
          tm.registerTool(tool);
        }
        ts.onInit?.(ctx, tm.entryData);
        if (tm.externalRefresh) {
          const unsub = ts.onSubscribe?.(ctx, tm.externalRefresh);
          if (unsub) sessionUnsubs.set(sessionId, unsub);
          tm.externalRefresh();
        }
      }

      return () => {
        detach?.();
        const idx = masterToolSets.indexOf(ts);
        if (idx !== -1) masterToolSets.splice(idx, 1);
        for (const tool of tools) {
          const masterIdx = masterTools.findIndex((t) => t.name === tool.name);
          if (masterIdx !== -1) masterTools.splice(masterIdx, 1);
          for (const tm of slots.values()) {
            tm.unregisterByName(tool.name);
          }
        }
        for (const sessionId of slots.keys()) {
          // Tear down the subscription wired by onSubscribe, then notify the
          // ToolSet that the session is gone.
          sessionUnsubs.get(sessionId)?.();
          ts.onRemove?.(makeCtx(sessionId));
        }
        sessionUnsubs.clear();
      };
    },

    getRegisteredToolSets(): readonly ToolSet[] {
      // Return ALL registered toolsets — both config-time (toolSets) and
      // runtime-registered (masterToolSets) — so callers such as
      // createSubAgentMetaTools can wire per-agent lifecycle hooks
      // that live in the config-time list.
      return getAllToolSets();
    },
  };
}

export type ToolLifecycle = ReturnType<typeof createToolLifecycle>;
