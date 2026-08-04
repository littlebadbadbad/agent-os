import {
  createAgentClient,
  createSubAgentToolset,
} from "@agent-sdk";
import type { ToolSet } from "@agent-type";
import { createPluginSystem } from "./plugin";
import { createPluginManagerToolSet } from "./plugin/core/pluginManagerToolSet";
import type { AgentPluginContext } from "./plugin/host";
import { asyncHandler } from "./handlers/asyncHandler";
import { streamHandler } from "./handlers/streamHandler";
import { providerConfigStore } from "./store/providerConfigStore";
import {
  sessionStore,
} from "./createAdapters";
import { createDefaultUIRenderer } from "./defaultRenderUI";
import { IS_ELECTRON_IPC } from "./env";

// ── Internal brand ─────────────────────────────────────────────────────────────
// Opaque symbol used to identify "built-in" ToolSets.
// Created once per agent-client instance — external code cannot reproduce it.
// The plugin system injects this brand into all built-in plugin ToolSets at
// registration time; the SDK uses it to grant privileged capabilities.

const INTERNAL_BRAND = Symbol('agent.internal');

// ── Plugin system ──────────────────────────────────────────────────────────────
// Initialised after agent creation so plugins can register tools on sessions.

export const pluginSystem = createPluginSystem();

/**
 * Combined AgentPluginContext that registers tools on BOTH agents.
 * This lets pluginSystem.init() be called once while wiring tools
 * into both the stream and async agents simultaneously.
 */
function createCombinedPluginContext(): AgentPluginContext {
  // Use getters so these work regardless of module evaluation order.
  const ctx: AgentPluginContext = {
    addToolSet: (ts) => {
      const unsub1 = streamAgent.registerToolSet(ts);
      const unsub2 = asyncAgent.registerToolSet(ts);
      return () => { unsub1(); unsub2(); };
    },
    getRegisteredToolSets: () => {
      // Union — both agents share most tools, but deduplicate by name.
      const names = new Set<string>();
      return [
        ...streamAgent.getRegisteredToolSets(),
        ...asyncAgent.getRegisteredToolSets(),
      ].filter((ts) => {
        if (names.has(ts.name)) return false;
        names.add(ts.name);
        return true;
      });
    },
    getTools: () => {
      // Union — merge both agents' tools, deduplicate by name.
      const names = new Set<string>();
      return [
        ...streamAgent.getTools(),
        ...asyncAgent.getTools(),
      ].filter((t) => {
        if (names.has(t.name)) return false;
        names.add(t.name);
        return true;
      });
    },
    agentName: 'stream+async',
    /** Internal brand — injected into all built-in plugin ToolSets. */
    internalBrand: INTERNAL_BRAND,
  };
  return ctx;
}

const SYSTEM_PROMPT = "";

// Restore persisted sessions from the backend.

// ── Shared tools ──────────────────────────────────────────────────────────────
// Sub-agent meta-tools only.
// Core ToolSets (variable, memory-graph, tool-search, tool-result-compressor,
// permissions, delegation-nudge) are registered as plugins via the plugin system.

// Sub-agent meta-tools — each handler variant gets its own set.
// The tool pool is derived lazily from each agent's live registered tools.
const asyncSubAgentToolset = createSubAgentToolset("async", {
  withVariables: true,
  brand: INTERNAL_BRAND,
});
const streamSubAgentToolset = createSubAgentToolset("stream", {
  withVariables: true,
  brand: INTERNAL_BRAND,
});

// Plugin management is core capability, always available — not itself a
// toggleable plugin — so it's registered directly, like the sub-agent toolset.
const sharedToolSets: readonly ToolSet[] = [createPluginManagerToolSet(pluginSystem)];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check whether the sessionStorage flush marker indicates an unclean shutdown
 * within the last 10 minutes.  Returns true if a recent marker exists,
 * meaning the file-based session data might be stale.
 */
function hasRecentFlushMarker(agentId: string): boolean {
  try {
    const raw = sessionStorage.getItem(`__uap_flush_${agentId}`);
    if (!raw) return false;
    const backup = JSON.parse(raw) as { agentId: string; ts: number };
    if (Date.now() - backup.ts > 10 * 60 * 1000) {
      sessionStorage.removeItem(`__uap_flush_${agentId}`);
      return false;
    }
    sessionStorage.removeItem(`__uap_flush_${agentId}`);
    return true;
  } catch {
    return false;
  }
}

// ── Init Gate ─────────────────────────────────────────────────────────────
// Blocks ALL persistence writes until initSessions() completes, then drains
// one final save of the restored data.  This is strictly more robust than a
// data-content guard (e.g. "skip if messages.length === 0") because:
//
//   • Some ToolSet's onBuildSnapshot may inject fields into SessionEntryData
//     that make the snapshot appear "non-empty" even when it's still the
//     default template (race lost before restoreSessions).
//   • A temporal barrier has zero false negatives — nothing leaks through.
//
//   ── Lifecycle ──────────────────────────────────────────────────────────
//   Module load → createAgentClient → wireSessionPersistence
//     → doSave / scheduleSave  → onSessionsChange → makeDebouncedSave
//       ↓ _gate === 'closed'   → buffer the snapshot, do NOT write to disk
//   initSessions() → loadSessions → restoreSessions → _gate = 'open'
//     → drain buffered snapshot (carries real data from restoreSessions)
//     → subsequent saves pass through normally
//
type InitGateState = { status: 'closed'; pending: Array<() => void> } | { status: 'open' };
let _gate: InitGateState = { status: 'closed', pending: [] };

function makeDebouncedSave(agentId: string) {
  return (sessions: Parameters<typeof sessionStore.saveSessions>[1], _force?: boolean): void | Promise<void> => {
    if (_gate.status === 'closed') {
      // Only buffer saves that carry real session data (from restoreSessions).
      // Empty-template saves from the default "New Chat" session are dropped.
      const hasRealData = sessions.some(
        (s) => (s.messages && s.messages.length > 0) || (s.liveHistory && s.liveHistory.length > 0),
      );
      if (!hasRealData) return;
      // Buffer the real save — it will be drained once the gate opens.
      _gate.pending.push(() => sessionStore.saveSessions(agentId, sessions));
      return;
    }
    return sessionStore.saveSessions(agentId, sessions);
  };
}

/** Call once after all agents have been restored to open the persistence gate. */
function openPersistenceGate(): void {
  if (_gate.status === 'open') return;
  const pending = _gate.pending;
  _gate = { status: 'open' };
  // Drain buffered saves (they carry the data from restoreSessions).
  for (const flush of pending) flush();
}

// ── Agents (created without initial sessions) ───────────────────────────────────

export const asyncAgent = createAgentClient({
  id: "async-agent",
  handler: asyncHandler,
  systemPrompt: SYSTEM_PROMPT,
  toolSets: [...sharedToolSets, asyncSubAgentToolset],
  tools: [],
  internalBrand: INTERNAL_BRAND,
  onSessionsChange: makeDebouncedSave('async-agent'),
  renderUI: createDefaultUIRenderer({
    icon: "⚡",
    theme: {
      primaryColor: "#0078d4",
      primaryDarkColor: "#005fa3",
      primaryDeepColor: "#003a6e",
      primaryLightColor: "#50e6ff",
    },
    initialWidth: 520,
  }),
});

export const streamAgent = createAgentClient({
  id: "stream-agent",
  handler: streamHandler,
  systemPrompt: SYSTEM_PROMPT,
  toolSets: [...sharedToolSets, streamSubAgentToolset],
  tools: [],
  internalBrand: INTERNAL_BRAND,
  onSessionsChange: makeDebouncedSave('stream-agent'),
  renderUI: createDefaultUIRenderer({
    icon: "🌊",
    theme: {
      primaryColor: "#57C8F2",
      primaryDarkColor: "#2EA8D5",
      primaryDeepColor: "#1A7EA3",
      primaryLightColor: "#A8E4F8",
    },
    initialWidth: 520,
  }),
});

export async function initSessions(): Promise<void> {
  // Initialise plugin system FIRST so plugins register their ToolSets
  // BEFORE session restore (plugged tools appear in restored sessions).
  await pluginSystem.init(createCombinedPluginContext());
  // Load provider config before anything else
  await providerConfigStore.load();

  const hadUncleanShutdown = hasRecentFlushMarker('async-agent') || hasRecentFlushMarker('stream-agent');
  if (hadUncleanShutdown) {
    console.warn('[initSessions] Unclean shutdown detected — session data may be incomplete.');
  }

  const [asyncSessions, streamSessions] = await Promise.all([
    sessionStore.loadSessions("async-agent"),
    sessionStore.loadSessions("stream-agent"),
  ]);
  if (asyncSessions.length > 0) asyncAgent.restoreSessions(asyncSessions);
  if (streamSessions.length > 0) streamAgent.restoreSessions(streamSessions);

  // 🛡 Open the persistence gate — any saves buffered during init (carrying
  // real restored data) are drained NOW, and all subsequent saves pass
  // through to the backend normally.
  openPersistenceGate();

  // ── Shutdown persistence guard ──────────────────────────────────────────
  // BROWSER: beforeunload/visibilitychange/pagehide flush session data before
  // the tab closes or switches away.
  //
  // ELECTRON: The renderer's beforeunload is unreliable for async IPC —
  // the renderer process may be torn down before ipcRenderer.invoke completes.
  // Instead, the main process sends an 'app:requestFlush' IPC message on
  // window close.  We listen for it, flush ALL agents, then reply
  // 'app:flushComplete' so the main process can safely close the window.
  if (typeof window !== 'undefined') {
    if (IS_ELECTRON_IPC) {
      // ── Electron: main-process-coordinated flush (once for all agents) ───
      const electronAPI = window.electronAPI;
      if (electronAPI?.on) {
        electronAPI.on('app:requestFlush', () => {
          Promise.all([
            asyncAgent.flushPersistence(),
            streamAgent.flushPersistence(),
          ]).then(
            () => electronAPI.invoke('app:flushComplete'),
            () => electronAPI.invoke('app:flushComplete'),
          );
        });
      }
    }

    // Per-agent browser guards (beforeunload etc.) — in Electron these are
    // backup only; the main-process IPC flow is the primary mechanism.
    function registerAgentFlushGuard(agent: typeof asyncAgent, agentId: string) {
      const doFlush = () => {
        agent.flushPersistence().catch(() => {});
        // Last-resort sync backup: write a marker so initSessions knows to
        // re-check the file-based data on next boot.  The actual data is
        // written by flushPersistence() above; this marker just confirms
        // we attempted a flush.
        try {
          sessionStorage.setItem(
            `__uap_flush_${agentId}`,
            JSON.stringify({ agentId, ts: Date.now() }),
          );
        } catch { /* sessionStorage may be unavailable */ }
      };
      window.addEventListener('beforeunload', doFlush);
      if (!IS_ELECTRON_IPC) {
        // visibilitychange/pagehide: opportunistic flush for browser tabs.
        window.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') doFlush();
        });
        window.addEventListener('pagehide', doFlush);
      }
    }

    registerAgentFlushGuard(asyncAgent, 'async-agent');
    registerAgentFlushGuard(streamAgent, 'stream-agent');
  }
}
