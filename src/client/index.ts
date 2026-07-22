import {
  createDefaultContainer,
  wireSessionPersistence,
} from "./helpers";
import { resolveToolSetTools, type Attachment, type Tool, type SessionEntryData } from '@agent-type';
import { resolveAgentClientConfig } from "@agent-sdk/client/resolveConfig";
import type { ToolManager } from "@agent-sdk/client/toolManager";
import { createSessionManager } from "@agent-sdk/client/sessionManager";
import type { SessionManager } from "@agent-sdk/client/sessionManager.types";
import type { AgentClientConfig } from "@agent-sdk/client/types";
import type { ToolSet, ToolSetContext, AgentClientLike } from '@agent-type';
import { MAIN_CONVERSATION_ID } from "@agent-sdk/tools/toolSet";
import { createToolLifecycle, ensureToolSetSymbol } from "@agent-sdk/client/toolLifecycle";
import { createSessionFactory } from "@agent-sdk/client/sessionFactory";
import { createSnapshotBuilder } from "@agent-sdk/client/snapshotBuilder";
import { createToolSetScope } from "@agent-sdk/tools/toolSetScope";

export type { AgentClientConfig, ToolStateEntry } from "./types";
export type {
  AgentSession,
  AgentSessionState,
  AgentSessionConfig,
} from "./agentSession";
export type {
  SessionManager,
  SessionEntryData,
  SessionListEntry,
  SessionManagerState,
} from "./sessionManager.types";

// ── Snapshot type ─────────────────────────────────────────────────────────────

export type AgentClient = ReturnType<typeof createAgentClient>;

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAgentClient(agentClientConfig: AgentClientConfig) {
  const config = resolveAgentClientConfig(agentClientConfig);
  const {
    id,
    handler,
    systemPrompt,
    toolChoice,
    tools,
    toolSets,
    renderUI,
    initialSessions,
    onSessionsChange,
    maxAgentTurns,
    enableAttachments,
  } = config;

  let destroy: (() => void) | null = null;

  // ── Shared infrastructure ─────────────────────────────────────────────────
  // These are shared across all sessions.

  // ── Master tool registry ──────────────────────────────────────────────────
  // Tracks what tools every session should have.

  const masterTools: Tool[] = [];
  const masterToolSets: ToolSet[] = [];

  function getAllToolSets(): ToolSet[] {
    return [...toolSets, ...masterToolSets];
  }

  // Ensure every ToolSet has a symbol so onGetSymbolState is always collected.
  for (const ts of toolSets) {
    ensureToolSetSymbol(ts);
  }

  // Register tools supplied directly via config.tools.
  for (const tool of tools) {
    masterTools.push(tool);
  }

  // Register tools from all configured tool sets.
  for (const ts of toolSets) {
    for (const tool of resolveToolSetTools(ts)) {
      masterTools.push(tool as Tool);
    }
  }

  /** Per-session tool managers, keyed by session ID. */
  const slots = new Map<string, ToolManager>();

  /** Stable agent name — the configured `id` or `'main'` as fallback. */
  const agentId = id ?? 'main';

  // ── Lazy session-manager reference ───────────────────────────────────────
  // Passed to toolsLifeCycle so getFilteredTools() can query the active
  // session. Wired to the real sessionMgr once it is created below.
  const lazySessionMgr: Pick<SessionManager, 'getState'> = {
    getState: () => ({ sessions: [], activeSessionId: undefined }),
  };

  // ── Lifecycle method groups ───────────────────────────────────────────────
  // Built before sessionMgr so onAttach can safely call registerTool /
  // registerToolSet before any session is opened.
  let agentRef: AgentClientLike | null = null;

  const toolsLifeCycle = createToolLifecycle({
    masterTools,
    masterToolSets,
    slots,
    sessionMgr: lazySessionMgr,
    getAllToolSets,
    agentId,
    getAgentClient: () => {
      if (!agentRef) throw new Error('[AgentClient] getAgentClient called before client was fully constructed');
      return agentRef;
    },
  });

  // Build an early AgentClientLike proxy and fire onAttach for config-time
  // ToolSets now — before any session is created — so tools injected by
  // onAttach (e.g. proxy tools) are present when onInitSession runs.
  agentRef = { ...toolsLifeCycle, handler };
  for (const ts of toolSets) {
    ts.onAttach?.(agentRef);
  }

  // ── Session factory ───────────────────────────────────────────────────────

  // Holder for the persistence-flush function — wired below, after the
  // sessionMgr is constructed.  Using a holder lets us pass a stable function
  // reference into the factory without rearranging the construction order.
  const persistenceHolder: { flush?: () => Promise<void> } = {};

  const mainScope = createToolSetScope(getAllToolSets, handler);

  const makeSession = createSessionFactory({
    masterTools,
    slots,
    getAllToolSets,
    id,
    systemPrompt,
    toolChoice,
    handler,
    maxAgentTurns,
    enableAttachments,
    flushPersistence: onSessionsChange
      ? () => persistenceHolder.flush?.() ?? Promise.resolve()
      : undefined,
  });

  // ── Session manager ───────────────────────────────────────────────────────

  const sessionMgr = createSessionManager(makeSession, {
    initialSessions,
    onRemoveSession(id) {
      slots.delete(id);
      const rmCtx: ToolSetContext = { sessionId: id, agentName: agentId, conversationId: MAIN_CONVERSATION_ID };
      mainScope.removeScope(rmCtx);
    },
  });

  // Wire the real sessionMgr into the lazy holder used by toolsLifeCycle.
  lazySessionMgr.getState = () => sessionMgr.getState();

  // ── Snapshot helper ───────────────────────────────────────────────────────

  const buildSnapshot = createSnapshotBuilder({ sessionMgr, agentId, getAllToolSets });

  // Debounce snapshot saves so streaming tokens don't cause a write per chunk.
  if (onSessionsChange) {
    const handle = wireSessionPersistence(sessionMgr, onSessionsChange, buildSnapshot);
    persistenceHolder.flush = handle.flush;
  }

  // ── Headless subscribe (active-session aware) ─────────────────────────────

  function subscribe(fn: () => void): () => void {
    let sessionUnsub: (() => void) | null = null;

    function resubscribe() {
      sessionUnsub?.();
      const active = sessionMgr.getActiveSession();
      sessionUnsub = active ? active.subscribe(fn) : null;
    }

    resubscribe();
    const mgrUnsub = sessionMgr.subscribe(() => {
      resubscribe();
      fn();
    });

    return () => {
      mgrUnsub();
      sessionUnsub?.();
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  const client = {
    render(container?: HTMLElement): void {
      if (destroy !== null) return;
      destroy = renderUI(sessionMgr, container ?? createDefaultContainer());
    },

    // ── Session management ─────────────────────────────────────────────────

    getSessionManager(): SessionManager {
      return sessionMgr;
    },
    createSession(data?: Partial<SessionEntryData>) {
      return sessionMgr.createSession(data);
    },
    removeSession(id: string): void {
      sessionMgr.removeSession(id);
    },
    setActiveSession(id: string): void {
      sessionMgr.setActiveSession(id);
    },
    restoreSessions(sessions: SessionEntryData[]): void {
      // Unconditionally replace all current sessions with the restored data.
      // Remove all existing sessions first so per-session resources (slots,
      // ToolSet state) are properly cleaned up before fresh ones are created.
      for (const existing of sessionMgr.getState().sessions) {
        sessionMgr.removeSession(existing.id);
      }
      for (const data of sessions) {
        sessionMgr.createSession(data);
      }
    },

    getSessionSnapshot(id?: string): SessionEntryData {
      const sessionId = id ?? sessionMgr.getState().activeSessionId;
      if (!sessionId) throw new Error("No active session");
      return buildSnapshot(sessionId);
    },

    // ── Headless message API ───────────────────────────────────────────────

    sendMessage(text: string, attachments?: readonly Attachment[]) {
      return (
        sessionMgr
          .getActiveSession()
          ?.sendMessage(text, attachments) ?? Promise.resolve()
      );
    },
    cancelMessage(): void {
      sessionMgr.getActiveSession()?.cancelMessage();
    },
    clearHistory(): void {
      sessionMgr.getActiveSession()?.clearHistory();
    },
    getMessages() {
      return sessionMgr.getActiveSession()?.getState().messages ?? [];
    },
    isLoading(): boolean {
      return sessionMgr.getActiveSession()?.getState().isLoading ?? false;
    },
    subscribe,

    // ── Handler ────────────────────────────────────────────────────────────

    handler,

    // ── Tool management ────────────────────────────────────────────────────

    ...toolsLifeCycle,

    // ── Persistence ───────────────────────────────────────────────────────

    /**
     * Force-flush any pending debounced session-save timers immediately.
     *
     * Call this on `beforeunload` / `visibilitychange` so that session data
     * lands on disk before the renderer process exits — otherwise the
     * double-debounce chain (SDK 200ms + UI 200ms) can drop up to 400ms of
     * state changes when the browser tab is closed abruptly (Ctrl+C).
     */
    async flushPersistence(): Promise<void> {
      if (persistenceHolder.flush) {
        await persistenceHolder.flush();
      }
    },
  };

  // Upgrade agentRef to the full client so future getAgentClient() calls
  // (e.g. from runtime registerToolSet) return the complete interface.
  // Config-time onAttach was already fired before session creation above.
  agentRef = client;

  // Refresh per-session external state so any description getters or state
  // that depended on the agent reference re-evaluate with correct data.
  for (const tm of slots.values()) {
    tm.externalRefresh?.();
  }

  return client;
}
