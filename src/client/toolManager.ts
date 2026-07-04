import { emptyRegistry, withTool, withoutTool, listRegisteredTools } from '@agent-sdk/tools/registry';
import type { ToolRegistry } from '@agent-sdk/tools/registry';
import type { Tool } from '@agent-type';
import type { SessionEntryData } from './sessionManager.types';

// ── Public interface ──────────────────────────────────────────────────────────

export type ToolManager = {
  getRegistry(): ToolRegistry;
  /** All registered tools (regardless of enabled/disabled state). */
  getTools(): readonly Tool[];
  /**
   * Register a tool; returns an unregister callback.
   * Also tracks the callback internally so the tool can be removed by name
   * via `unregisterByName`.
   */
  registerTool(tool: Tool): () => void;
  /**
   * Unregister a named tool without needing to hold the original callback.
   * No-op when the name is not registered.
   */
  unregisterByName(name: string): void;
  /**
   * Subscribe to tool registration/unregistration changes.
   * Does NOT fire for enable/disable changes (those are ToolStateToolSet's concern).
   */
  subscribe(fn: () => void): () => void;
  /**
   * The original entry data used to initialise this session.
   * Stored so that late-registered ToolSets receive the correct persisted data
   * in their `onInitSession` callbacks rather than a live `SessionListEntry`.
   */
  readonly entryData: SessionEntryData;
  /**
   * The external-state-change notifier registered by the UI layer via
   * `subscribeExternalState`. Set once on subscription; cleared on teardown.
   * Stored so that ToolSets registered after session creation can subscribe to
   * existing sessions immediately.
   */
  externalRefresh: (() => void) | null;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createToolManager(entryData?: SessionEntryData): ToolManager {
  let registry: ToolRegistry = emptyRegistry();
  const subscribers = new Set<() => void>();
  /** Internal reverse-lookup: tool name → its unregister callback. */
  const unregFns = new Map<string, () => void>();

  function notify(): void {
    subscribers.forEach((fn) => fn());
  }

  return {
    entryData: entryData ?? { id: '', title: '' },
    externalRefresh: null,

    getRegistry: () => registry,

    getTools(): readonly Tool[] {
      return listRegisteredTools(registry);
    },

    registerTool(tool: Tool): () => void {
      registry = withTool(registry, tool);
      notify();
      const unregister = () => {
        if (!unregFns.has(tool.name)) return; // already unregistered
        unregFns.delete(tool.name);
        registry = withoutTool(registry, tool.name);
        notify();
      };
      unregFns.set(tool.name, unregister);
      return unregister;
    },

    unregisterByName(name: string): void {
      unregFns.get(name)?.();
    },

    subscribe(fn: () => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
