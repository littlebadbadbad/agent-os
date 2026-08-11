/**
 * internal-apps/user-input/agent/pendingInput/toolSet.ts — PendingInput ToolSet
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
  SessionReadyHelpers,
  AppSlotDeclaration,
  AppStateExtension,
  SlotDisplayContext,
} from "@agent-type";
import type { Attachment } from "@agent-type";
import { ctxKey, MAIN_CONVERSATION_ID } from "@agent-type";
import { createPendingInputStore } from "./store";
import type { PendingInputStore } from "./store";
import type { PendingInputEntry } from "./types";

// Ensure SessionEntryExtension module augmentation is registered.
import "./types";
import { PendingInputStripState } from "../types";

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
 * Slot declarations are now registered via `registerToolSet(toolSet, slots)`
 * and stored independently from session state.
 */
export interface PendingInputSymbolState {
  readonly type: "pendingInput";
  readonly queueUserInput: (text: string) => void;
  readonly pendingInputCount: number;
  readonly pendingInputMessages: ReadonlyArray<{ id: string; text: string }>;
  readonly cancelQueuedInput: (id: string) => void;
  readonly resumeQueuedInputs: () => void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface PendingInputToolSetBundle {
  readonly toolSet: ToolSet<PendingInputStripState>;
  readonly slotDeclarations: readonly SlotDeclaration[];
}

export function createPendingInputToolSet(
  options: PendingInputToolSetOptions = {},
): PendingInputToolSetBundle {
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

  const toolSet = {
    symbol: PENDING_INPUT_SYMBOL,
    name: "pending-input",
    tools: [],

    // ── State (symbol-isolated for app iframe + flat keys for host integration) ──

    onGetSymbolState(ctx: ToolSetContext) {
      const key = ctxKey(ctx);
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
      }
    },

    // ── Message interception ──────────────────────────────────────────────
    // Called on every sendMessage attempt — including programmatic sends from
    // tools.  Intercepts when the agent is busy and queues for later delivery.

    onInterceptMessage(
      ctx: ToolSetContext,
      message: { readonly content: string; readonly attachments?: readonly Attachment[] },
      isLoading: boolean,
    ) {
      if (!isLoading) return;
      const key = ctxKey(ctx);
      const cbs = getCallbacks(key);
      cbs.queueUserInput(message.content);
      return { intercepted: true as const };
    },

    // ── Subscriptions ──────────────────────────────────────────────────────

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return store.subscribe(ctxKey(ctx), fn);
    },

    // ── Per-invoke injection ───────────────────────────────────────────────

    onBeforeInvoke(ctx: ToolSetContext) {
      return store
        .drainForInvoke(ctxKey(ctx))
        .map((e) => ({ role: "user" as const, content: e.text }));
    },

    // ── Post-run auto-continue ─────────────────────────────────────────────

    onAfterRun(ctx: ToolSetContext, outcome: AgentRunOutcome): void {
      if (outcome === "aborted" || outcome === "error") return;
      store.resume(ctxKey(ctx));
    },

    // ── Session lifecycle ──────────────────────────────────────────────────

    onReady(
      ctx: ToolSetContext,
      helpers: SessionReadyHelpers,
    ): void {
      store.setSendMessage(ctxKey(ctx), helpers.sendMessage);
    },

    onReset(ctx: ToolSetContext): void {
      store.reset(ctxKey(ctx));
    },

    onRemove(ctx: ToolSetContext): void {
      store.remove(ctxKey(ctx));
    },

    // ── Persistence ────────────────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext): {
      pendingInputs?: readonly PendingInputEntry[];
    } {
      const inputs = store.serialize(ctxKey(ctx));
      return inputs?.length ? { pendingInputs: [...inputs] } : {};
    },

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      const inputs = entryData?.pendingInputs;
      if (inputs?.length) store.restore(ctxKey(ctx), inputs);
    },
  } as ToolSet<PendingInputStripState>;

  const slotDeclarations: readonly SlotDeclaration[] = [
    {
      type: "inlinePrompt" as const,
      shouldRender: (slotCtx: SlotDisplayContext) =>
        store.getQueue(
          ctxKey({
            sessionId: slotCtx.sessionId,
            agentName: slotCtx.agentName,
            conversationId: slotCtx.conversationId,
          }),
        ).length > 0,
    },
  ];

  return { toolSet, slotDeclarations };
}
