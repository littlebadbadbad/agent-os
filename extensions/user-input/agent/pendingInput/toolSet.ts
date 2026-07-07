/**
 * extensions/user-input/agent/pendingInput/toolSet.ts — PendingInput ToolSet
 *
 * Enables user-input interjection during an active agent loop.
 * While the agent is processing (isLoading=true), the UI calls
 * `queueUserInput(text)` to enqueue messages. On every LLM turn,
 * `onBeforeInvoke` drains the queue and injects entries into history.
 *
 * Ported from src/tools/pendingInput/toolSet.ts with these changes:
 *   - Uses `onGetSymbolState` instead of `onGetState` (symbol-isolated)
 *   - Exports PENDING_INPUT_SYMBOL for host access from SessionContent
 */

import type {
  ToolSet,
  ToolSetContext,
  AgentRunOutcome,
  SessionEntryData,
  PluginSlotDeclaration,
  PluginUiAdapter,
  SlotDisplayContext,
} from "@agent-type";
import { MAIN_CONVERSATION_ID } from "@agent-type";
import { createPendingInputStore } from "./store";
import type { PendingInputStore } from "./store";
import type { PendingInputEntry } from "./types";

// Ensure SessionEntryExtension module augmentation is registered.
import "./types";

// ── Symbol ────────────────────────────────────────────────────────────────────

export const PENDING_INPUT_SYMBOL: unique symbol = Symbol("pending-input");

// ── Options ───────────────────────────────────────────────────────────────────

export interface PendingInputToolSetOptions {
  /**
   * External store instance (default: factory creates its own).
   * Pass in when you need cross-toolset composite conditions.
   */
  readonly store?: PendingInputStore | undefined;
}

// ── Symbol-state shape ────────────────────────────────────────────────────────

/**
 * Shape exposed via `onGetSymbolState`.
 * Host reads from `sessionState[PENDING_INPUT_SYMBOL]`.
 *
 * Extends {@link PluginUiAdapter} so the host's `SlotRegistry` discovers
 * `slots` without needing a per-plugin-type hardcoded check.
 */
export interface PendingInputSymbolState extends PluginUiAdapter {
  readonly type: "pendingInput";
  readonly queueUserInput: (text: string) => void;
  readonly pendingInputCount: number;
  readonly pendingInputMessages: ReadonlyArray<{ id: string; text: string }>;
  readonly cancelQueuedInput: (id: string) => void;
  readonly resumeQueuedInputs: () => void;
  /** Intersection required by PluginStateExtension (merged across all plugin toolsets). */
  readonly pendingUserInputs: readonly import("../requestUserInput/types").InlinePromptEntry[];
  readonly respondUserInput: (id: string, value: string | null) => void;
  /** Slot declarations for the host to discover. */
  readonly slots: readonly PluginSlotDeclaration[];
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPendingInputToolSet(
  options: PendingInputToolSetOptions = {},
): ToolSet {
  const store: PendingInputStore = options.store ?? createPendingInputStore();

  // ── Stable per-key callbacks ──────────────────────────────────────────────
  // onGetSymbolState is called on every external-state refresh; creating new
  // function instances each time makes useSyncExternalStore treat every
  // snapshot as "changed" even when the queue is identical.

  interface Callbacks {
    queueUserInput: (text: string) => void;
    cancelQueuedInput: (id: string) => void;
    resumeQueuedInputs: () => void;
  }
  const callbackCache = new Map<string, Callbacks>();

  function getCallbacks(key: string): Callbacks {
    let cbs = callbackCache.get(key);
    if (!cbs) {
      cbs = {
        queueUserInput(text: string) {
          store.enqueue(key, { id: crypto.randomUUID(), text });
        },
        cancelQueuedInput(id: string) {
          store.cancel(key, id);
        },
        resumeQueuedInputs() {
          store.resume(key);
        },
      };
      callbackCache.set(key, cbs);
    }
    return cbs;
  }

  // ── Composite store key ──────────────────────────────────────────────────
  // Uses plain sessionId for the main conversation, and `${sessionId}:${conversationId}`
  // for sub-agent conversations — matching the toolSetContextKey pattern.

  function storeKey(ctx: ToolSetContext): string {
    return ctx.conversationId === MAIN_CONVERSATION_ID
      ? ctx.sessionId
      : `${ctx.sessionId}:${ctx.conversationId}`;
  }

  return {
    symbol: PENDING_INPUT_SYMBOL,
    name: "pending-input",
    tools: [],

    // ── State (symbol-isolated for plugin iframe + flat keys for host integration) ──

    onGetSymbolState(ctx: ToolSetContext): PendingInputSymbolState {
      const key = storeKey(ctx);
      const queue = store.getQueue(key);
      const { queueUserInput, cancelQueuedInput, resumeQueuedInputs } =
        getCallbacks(key);

      return {
        type: "pendingInput" as const,
        queueUserInput,
        pendingInputCount: queue.length,
        pendingInputMessages: queue.map((e) => ({ id: e.id, text: e.text })),
        cancelQueuedInput,
        resumeQueuedInputs,
        pendingUserInputs: [],
        respondUserInput: () => {},
        slots: [
          {
            type: "messageInterceptor",
            id: "user-input.interceptor",
            shouldIntercept: (isLoading: boolean, _ctx: SlotDisplayContext) => isLoading,
            interceptMessage: (text: string) => queueUserInput(text),
          },
        ],
      };
    },

    // ── Subscriptions ──────────────────────────────────────────────────────

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return store.subscribe(storeKey(ctx), fn);
    },

    // ── Per-invoke injection ───────────────────────────────────────────────

    onBeforeInvoke(ctx: ToolSetContext) {
      return store
        .drainForInvoke(storeKey(ctx))
        .map((e) => ({ role: "user" as const, content: e.text }));
    },

    // ── Post-run auto-continue ─────────────────────────────────────────────

    onAfterRun(ctx: ToolSetContext, outcome: AgentRunOutcome): void {
      if (outcome === "aborted" || outcome === "error") return;
      store.resume(storeKey(ctx));
    },

    // ── Session lifecycle ──────────────────────────────────────────────────

    onSessionReady(
      ctx: ToolSetContext,
      sendMessage: (text: string) => void,
    ): void {
      store.setSendMessage(storeKey(ctx), sendMessage);
    },

    onResetSession(ctx: ToolSetContext): void {
      store.reset(storeKey(ctx));
    },

    onRemoveSession(ctx: ToolSetContext): void {
      store.remove(storeKey(ctx));
    },

    // ── Persistence ────────────────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext): {
      pendingInputs?: readonly PendingInputEntry[];
    } {
      const inputs = store.serialize(storeKey(ctx));
      return inputs?.length ? { pendingInputs: [...inputs] } : {};
    },

    onInitSession(ctx: ToolSetContext, entryData: SessionEntryData): void {
      const inputs = entryData.pendingInputs;
      if (inputs?.length) store.restore(storeKey(ctx), inputs);
    },
  };
}
