/**
 * PendingInputToolSet — enables user-input interjection during an active agent loop.
 *
 * While the agent is processing (isLoading=true), the UI calls `queueUserInput(text)`
 * to enqueue messages.  On every LLM turn `onBeforeInvoke` drains the entire queue
 * and injects all entries into the conversation history (and the UI) at once before
 * the next handler call.
 *
 * When the agent loop ends with messages still in the queue, `onAfterRun`
 * automatically starts a new run: the first queued entry is dispatched via
 * `sendMessage`; any remaining entries stay in the queue and are all drained
 * together by `drainForInvoke` on the first turn of that new run.
 *
 * After a page reload, persisted pending messages are silently restored.  The
 * UI exposes a "Continue" button so the user can decide whether to send them.
 *
 * Register via `createAgentClient({ toolSets: [createPendingInputToolSet()] })`.
 */

import type { ToolSet, ToolSetContext, AgentRunOutcome } from '@agent-type';
import { toolSetContextKey } from '@agent-sdk/tools/toolSet';
import type { SessionEntryData } from '@agent-sdk/client/sessionManager.types';
import { createPendingInputStore } from './store';
import type { PendingInputEntry } from './types';

// Ensure the SessionEntryExtension module augmentation is registered.
import './types';

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPendingInputToolSet(): ToolSet {
  const store = createPendingInputStore();

  // ── Stable per-key callbacks ──────────────────────────────────────────────
  //
  // onGetState is called on every external-state refresh; creating new function
  // instances each time makes useSyncExternalStore treat every snapshot as
  // "changed" even when the queue data is identical.  Cache these callbacks
  // once per toolSetContextKey so React sees stable references.

  type Callbacks = {
    queueUserInput: (text: string) => void;
    cancelQueuedInput: (id: string) => void;
    resumeQueuedInputs: () => void;
  };
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

  return {
    name: 'pending-input',
    tools: [],

    // ── State ────────────────────────────────────────────────────────────────

    onGetState(ctx: ToolSetContext) {
      const key = toolSetContextKey(ctx);
      const queue = store.getQueue(key);
      const { queueUserInput, cancelQueuedInput, resumeQueuedInputs } = getCallbacks(key);

      return {
        queueUserInput,
        pendingInputCount: queue.length,
        pendingInputMessages: queue.map((e) => ({ id: e.id, text: e.text })),
        cancelQueuedInput,
        resumeQueuedInputs,
      };
    },

    // ── Subscriptions ────────────────────────────────────────────────────────

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return store.subscribe(toolSetContextKey(ctx), fn);
    },

    // ── Per-invoke injection ──────────────────────────────────────────────────
    // Drains the entire queue and returns all entries as user messages to be
    // injected into history (and shown in the UI) before the next LLM call.

    onBeforeInvoke(ctx: ToolSetContext) {
      return store
        .drainForInvoke(toolSetContextKey(ctx))
        .map((e) => ({ role: 'user' as const, content: e.text }));
    },

    // ── Post-run auto-continue ────────────────────────────────────────────────
    // After a successful run, send the next queued entry as a fresh agent run.
    // Aborted / errored runs preserve the queue for manual retry.

    onAfterRun(ctx: ToolSetContext, outcome: AgentRunOutcome): void {
      if (outcome === 'aborted' || outcome === 'error') return;
      store.resume(toolSetContextKey(ctx));
    },

    // ── Session lifecycle ─────────────────────────────────────────────────────

    onSessionReady(ctx: ToolSetContext, sendMessage: (text: string) => void): void {
      store.setSendMessage(toolSetContextKey(ctx), sendMessage);
      // Pending messages from a page reload are silently restored.
      // We intentionally do NOT auto-send — the UI exposes a "Continue" button
      // so the user can review and decide before the next run starts.
    },

    onResetSession(ctx: ToolSetContext): void {
      store.reset(toolSetContextKey(ctx));
    },

    onRemoveSession(ctx: ToolSetContext): void {
      store.remove(toolSetContextKey(ctx));
    },

    // ── Persistence ───────────────────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext): { pendingInputs?: PendingInputEntry[] } {
      const inputs = store.serialize(toolSetContextKey(ctx));
      return inputs?.length ? { pendingInputs: [...inputs] } : {};
    },

    onInitSession(ctx: ToolSetContext, entryData: SessionEntryData): void {
      const inputs = entryData.pendingInputs;
      if (inputs?.length) store.restore(toolSetContextKey(ctx), inputs);
    },
  };
}
