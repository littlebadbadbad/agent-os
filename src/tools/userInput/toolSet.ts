// ── Module augmentation side-effect ──────────────────────────────────────────
// Importing this module registers the AgentSessionExtension fields.
import './types';

import type { ToolSet, ToolSetContext, ToolContextPatch } from '@agent-type';
import type { ToolExecutionContext } from '@agent-type';
import type { SessionEntryData } from '../../client/sessionManager.types';
import type { PendingUserInput, UserInputToolSetOptions } from './types';
import { createUserInputStore } from './store';
import { askUserTool } from './askUser';

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Optional ToolSet that gives every tool in the session (main agent and all
 * sub-agents) the ability to call `context.requestUserInput()`.
 *
 * ### What it provides
 * - `context.requestUserInput` — injected into every tool call via the
 *   `onPatchToolContext` hook.  When a tool calls it, the request is added to
 *   `AgentSessionState.pendingUserInputs` (visible in the UI) and the tool
 *   suspends until the user responds.
 * - `state.respondUserInput(id, value)` — call from the UI to unblock a
 *   waiting tool and remove its entry from `pendingUserInputs`.
 *
 * ### Multiple simultaneous prompts
 * All in-flight requests from every conversation in the session share one flat
 * list, keyed by `sessionId`.  Sub-agent requests appear alongside main-agent
 * requests; the UI can distinguish them via `conversationId` and `agentName`.
 *
 * ### Adapter mode
 * Supply `adapter` to bypass the UI queue entirely — all `requestUserInput`
 * calls are forwarded to `adapter.prompt()` with no state changes.
 *
 * ### Ghost restore
 * Non-ephemeral pending inputs are persisted in the session snapshot and
 * restored on page reload.  The ghost entry is visible in the UI immediately;
 * once `sendMessage` is available (via `onSessionReady`) the user's
 * answer is sent as a new agent turn, continuing execution where it left off.
 *
 * @example
 * ```ts
 * createAgentClient({
 *   handler,
 *   toolSets: [createUserInputToolSet()],
 * });
 * ```
 */
export function createUserInputToolSet(options: UserInputToolSetOptions = {}): ToolSet {
  const { adapter } = options;

  const store = createUserInputStore();

  // Per-session mutable resolve holders for ghost entries.
  // `onInitSession` adds ghosts with placeholder resolves; `onSessionReady`
  // upgrades them to real `sendMessage`-based resolves.
  const ghostHolders = new Map<string, Map<string, { fn: (v: string | null) => void }>>();

  // ── Helpers ───────────────────────────────────────────────────────────────

  function key(ctx: ToolSetContext): string {
    return ctx.sessionId;
  }

  // ── ToolSet ───────────────────────────────────────────────────────────────

  return {
    name: 'user-input',
    description: 'User-input prompting via the chat UI',
    coreTools: ['ask_user'],
    tools: [askUserTool],

    onInitSession(ctx: ToolSetContext, entryData: SessionEntryData): void {
      if (adapter) return; // adapter mode bypasses the store

      const saved = entryData.pendingUserInputs;

      if (!saved?.length) return;

      const sessionId = key(ctx);
      let holders = ghostHolders.get(sessionId);
      if (!holders) {
        holders = new Map();
        ghostHolders.set(sessionId, holders);
      }

      for (const entry of saved) {
        if (entry.request.ephemeral) continue;
        // Mutable holder — upgraded in onSessionReady.
        const holder: { fn: (v: string | null) => void } = { fn: () => {} };
        holders.set(entry.id, holder);
        store.addGhost(sessionId, entry, (v) => holder.fn(v));
      }
    },

    onSessionReady(ctx: ToolSetContext, sendMessage: (text: string) => void): void {
      if (adapter) return;

      const sessionId = key(ctx);
      const holders = ghostHolders.get(sessionId);
      if (!holders) return;

      for (const holder of holders.values()) {
        holder.fn = (v) => { if (v !== null) sendMessage(v); };
      }
      ghostHolders.delete(sessionId);
    },

    onRemoveSession(ctx: ToolSetContext): void {
      store.removeSession(key(ctx));
    },

    onResetSession(ctx: ToolSetContext): void {
      store.resetSession(key(ctx));
    },

    onGetState(ctx: ToolSetContext) {
      return {
        pendingUserInputs: store.getAll(key(ctx)),
        respondUserInput: store.getResponder(key(ctx)),
      };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return store.subscribe(key(ctx), fn);
    },

    onBuildSnapshot(ctx: ToolSetContext) {
      return { pendingUserInputs: store.serialize(key(ctx)) };
    },

    onPatchToolContext: Object.assign(
      function (
        ctx: ToolSetContext,
        signal: AbortSignal,
      ): Partial<ToolExecutionContext> {
        const sessionId = key(ctx);
        return {
          requestUserInput: (req, id) =>
            new Promise<string | null>((resolve) => {
              const entryId = id ?? crypto.randomUUID();
              store.add(sessionId, {
                id: entryId,
                request: req,
                conversationId: ctx.conversationId,
                agentName: ctx.agentName,
                resolve,
              });
              signal.addEventListener(
                'abort',
                () => store.remove(sessionId, entryId, null),
                { once: true },
              );
              // Adapter mode: forward to adapter and auto-resolve the store entry
              // when it returns.  First responder wins (abort vs. adapter return).
              // Without this the store entry would linger until abort, and the UI
              // would show a stale "waiting for input" card even in headless mode.
              if (adapter) {
                adapter.prompt(req).then(
                  (v) => store.remove(sessionId, entryId, v),
                  ()  => store.remove(sessionId, entryId, null),
                );
              }
              // Non-adapter mode: entry stays until the UI calls respondUserInput.
            }),
          cancelUserInput: (id) => store.remove(sessionId, id, null),
        };
      } as ToolContextPatch,
      {
        comment:
          '`context.requestUserInput(request, id?)` → `Promise<string | null>` — ' +
          'suspend tool execution until the user responds to a chat prompt.\n' +
          '`context.cancelUserInput?(id)` — cancel a pending prompt programmatically.',
      },
    ),
  };
}
