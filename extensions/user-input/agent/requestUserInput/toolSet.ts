import {
  type ToolSet,
  type ToolSetContext,
  type ToolContextPatch,
  type SessionEntryData,
  type UserInputRequest,
  type SessionReadyHelpers,
  type Attachment,
  type PluginSlotDeclaration,
  type CompactToolCardDescriptor,
  type ToolCallInfo,
  type UserInputMode,
  ctxKey,
} from "@agent-type";
import { DETACHED_SENTINEL } from "@agent-type";
import { createUserInputStore } from "./store";
import { askUserTool } from "./askUser";
import type { UserInputAdapter, InlinePromptEntry } from "./types";

// ── Symbol ────────────────────────────────────────────────────────────────────

export const USER_INPUT_SYMBOL: unique symbol = Symbol("user-input");

function userInputDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const summary = info.status === 'running' ? 'ask_user\u2026' : 'ask_user';
  return { icon: '\uD83D\uDCAC', label: 'Ask User', summary, status: info.status };
}

// ── Symbol-state shape ────────────────────────────────────────────────────────

export interface UserInputSymbolState {
  readonly type: "requestUserInput";
  readonly pendingUserInputs: ReadonlyArray<InlinePromptEntry>;
  readonly respondUserInput: (id: string, value: string | null) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build an `InlinePromptEntry` from a `UserInputRequest`.
 */
function toInlinePromptEntry(
  id: string,
  request: UserInputRequest,
  conversationId: string,
  agentName: string,
): InlinePromptEntry {
  const base = {
    id,
    conversationId,
    agentName,
    toolCallId: request.toolCallId ?? id,
    toolName: request.toolName ?? "ask_user",
    mode: request.mode,
    ephemeral: request.ephemeral,
  };

  switch (request.type) {
    case "confirm":
      return { ...base, kind: "confirm" as const, message: request.message };
    case "text":
      return {
        ...base,
        kind: "text" as const,
        message: request.message,
        placeholder: request.placeholder,
        defaultValue:
          request.defaultValue !== undefined
            ? String(request.defaultValue)
            : undefined,
      };
    case "select":
      return {
        ...base,
        kind: "select" as const,
        message: request.message,
        options: request.options,
      };
    case "multiSelect":
      return {
        ...base,
        kind: "multiSelect" as const,
        message: request.message,
        options: request.options,
        minSelect: request.minSelect,
        maxSelect: request.maxSelect,
      };
    case "number":
      return {
        ...base,
        kind: "number" as const,
        message: request.message,
        placeholder: request.placeholder,
        defaultValue:
          request.defaultValue !== undefined
            ? String(request.defaultValue)
            : undefined,
        min: request.min,
        max: request.max,
        step: request.step,
      };
    default:
      return {
        ...base,
        kind: "text" as const,
        message: (request as { message?: string }).message ?? "",
      };
  }
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface UserInputToolSetOptions {
  readonly adapter?: UserInputAdapter | undefined;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface UserInputToolSetBundle {
  readonly toolSet: ToolSet;
  readonly slotDeclarations: readonly PluginSlotDeclaration[];
}

export function createUserInputToolSet(
  options: UserInputToolSetOptions = {},
): UserInputToolSetBundle {
  const { adapter } = options;
  const store = createUserInputStore();

  // Persisted entries that need to be wired once sendMessage is ready.
  // Keyed by sessionId → array of saved InlinePromptEntry.
  const pendingRestore = new Map<string, readonly InlinePromptEntry[]>();

  // `sendMessage` refs injected into onPatchToolContext.
  // Keyed by sessionId.
  const sendMessageByKey = new Map<string, (text: string) => void>();

  // ── Detached-mode answer accumulator ─────────────────────────────────────
  // Keyed by sessionId. Accumulates answers until ALL detached prompts in
  // that session are answered, then flushes via sendMessage.
  const detachedAccum = new Map<string, string[]>();

  /** Flush all accumulated detached answers for a session via sendMessage. */
  function flushDetached(sessionId: string): void {
    const answers = detachedAccum.get(sessionId);
    if (!answers?.length) return;
    detachedAccum.delete(sessionId);
    const sm = sendMessageByKey.get(sessionId);
    for (const ans of answers) sm?.(ans);
  }

  /** Count unresolved detached-mode prompts in a session. */
  function countPendingDetached(sessionId: string): number {
    return store
      .getAll(sessionId)
      .filter((e) => e.mode === "detached").length;
  }

  // ── onPatchToolContext (injects requestUserInput / sendMessage) ────────────

  const patchFn: ToolContextPatch = (
    ctx: ToolSetContext,
    signal: AbortSignal,
  ) => {
    const sessionId = ctxKey(ctx);

    return {
      sendMessage: sendMessageByKey.get(sessionId),

      requestUserInput: (
        req: UserInputRequest,
        id?: string,
      ): Promise<string | null> =>
        new Promise<string | null>((resolvePromise) => {
          const entryId = id ?? crypto.randomUUID();
          const enriched: UserInputRequest = {
            ...req,
            toolCallId: req.toolCallId ?? entryId,
            toolName: req.toolName ?? "ask_user",
          };
          const prompt = toInlinePromptEntry(
            entryId,
            enriched,
            ctx.conversationId,
            ctx.agentName,
          );

          const mode: UserInputMode = req.mode ?? "bound";

          if (mode === "detached") {
            // ── Detached mode ─────────────────────────────────────────
            // Entry resolve accumulates answers.  When ALL detached
            // prompts are answered the batch is flushed via sendMessage.
            const entryResolve = (value: string | null): void => {
              if (value === null) return; // cancelled — skip
              const list = detachedAccum.get(sessionId) ?? [];
              list.push(value);
              detachedAccum.set(sessionId, list);

              // Entry was already removed from store by the caller
              // (store.remove or respondUserInput).  Count remaining.
              if (countPendingDetached(sessionId) === 0) {
                flushDetached(sessionId);
              }
            };

            store.add(sessionId, {
              ...prompt,
              mode: "detached",
              resolve: entryResolve,
            });

            signal.addEventListener(
              "abort",
              () => store.remove(sessionId, entryId, null),
              { once: true },
            );

            if (adapter) {
              adapter.prompt(req).then(
                (v) => store.remove(sessionId, entryId, v),
                () => store.remove(sessionId, entryId, null),
              );
            }

            // Resolve the returned Promise immediately with sentinel.
            resolvePromise(DETACHED_SENTINEL);
          } else {
            // ── Bound mode (default) — current behavior ───────────────
            store.add(sessionId, { ...prompt, resolve: resolvePromise });

            signal.addEventListener(
              "abort",
              () => store.remove(sessionId, entryId, null),
              { once: true },
            );

            if (adapter) {
              adapter.prompt(req).then(
                (v) => store.remove(sessionId, entryId, v),
                () => store.remove(sessionId, entryId, null),
              );
            }
          }
        }),

      cancelUserInput: (id: string): void => {
        store.remove(sessionId, id, null);
      },
    };
  };

  patchFn.comment =
    "`context.requestUserInput(request, id?)` → `Promise<string | null>` — " +
    "suspends tool execution until the user responds (bound) or resolves " +
    "immediately (detached, answer arrives as user message).\n" +
    "Set `request.mode = 'detached'` for fire-and-forget prompts.\n" +
    "`context.cancelUserInput?(id)` — cancel a pending prompt programmatically.\n" +
    "`context.sendMessage?(text)` — send a user message into the conversation.";

  const slotDeclarations: readonly PluginSlotDeclaration[] = [
    {
      type: "inlinePrompt" as const,
      shouldRender: (ctx) => store.getAll(ctxKey(ctx)).length > 0,
    },
    { type: "toolCard" as const, toolNames: ['ask_user'] },
    { type: "compactToolCard" as const, toolNames: ['ask_user'], getDescriptor: userInputDescriptor },
  ];

  const toolSet = {
    symbol: USER_INPUT_SYMBOL,
    name: "user-input",
    description: "Ask user for input",
    coreTools: ["ask_user"],
    tools: [askUserTool],

    // ── System prompt ────────────────────────────────────────────────────────

    onGetSystemPrompt() {
      return [
        "## ask_user tool — usage rules",
        "",
        "Always use `ask_user` when you need information from the user that you cannot infer or guess:",
        "- The user's intent is ambiguous and the wrong choice is hard to undo",
        "- A required parameter is missing and no default is reasonable",
        "- The task has multiple equally valid interpretations",
        "- You need explicit confirmation before a destructive/irreversible operation",
        "",
        "5 prompt types:",
        '- **confirm** — yes/no question. Returns `"yes"` or signals cancellation.',
        "- **text** — free-form answer. Use only when the response cannot be constrained.",
        "- **select** — pick one from a fixed list. Prefer this over text when the valid answers are known.",
        "- **multiSelect** — pick one or more options. Returns a JSON array string.",
        "- **number** — numeric input. Specify `min`/`max`/`step` to constrain.",

        "Tool execution is **suspended** until the user responds. If the user cancels, the tool",
        "returns a cancellation message — proceed with a fallback strategy rather than retrying.",
      ].join("\n");
    },

    // ── State (symbol-isolated) ──────────────────────────────────────────────

    onGetSymbolState(ctx: ToolSetContext) {
      const sessionKey = ctxKey(ctx);
      return {
        type: "requestUserInput" as const,
        pendingUserInputs: store.getAll(sessionKey),
        respondUserInput: store.getResponder(sessionKey),
      };
    },

    // ── Subscriptions ────────────────────────────────────────────────────────

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return store.subscribe(ctxKey(ctx), fn);
    },

    // ── onPatchToolContext ───────────────────────────────────────────────────

    onPatchToolContext: patchFn,

    // ── Message interception ──────────────────────────────────────────────
    // When the user types a new message in the chat input instead of
    // answering a pending prompt, cancel all pending prompts so the tool
    // resolves with null and the agent loop can proceed.

    onInterceptMessage(
      ctx: ToolSetContext,
      _message: {
        readonly content: string;
        readonly attachments?: readonly Attachment[];
      },
      _isLoading: boolean,
    ): void {
      const key = ctxKey(ctx);
      if (store.getAll(key).length > 0) {
        store.cancelAll(key);
      }
      // Return undefined — do NOT intercept the message. Let other
      // ToolSets (e.g. PendingInputToolSet) or the normal send path
      // handle it.
    },

    // ── Session lifecycle ───────────────────────────────────────────────────

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      if (adapter) return;
      const saved = entryData?.pendingUserInputs;
      if (!saved?.length) return;

      const sessionId = ctxKey(ctx);
      // Store the saved entries for wiring in onSessionReady.
      pendingRestore.set(sessionId, [...saved]);

      for (const entry of saved) {
        // Ghost entries with a temporary noop resolve — replaced in
        // onSessionReady with injectToolResult.
        store.addGhost(sessionId, entry, () => {});
      }
    },

    onReady(ctx: ToolSetContext, helpers: SessionReadyHelpers): void {
      if (adapter) return;

      const sessionId = ctxKey(ctx);

      // Wire sendMessage into the context-patch cache.
      sendMessageByKey.set(sessionId, helpers.sendMessage);

      // Replace ghost resolves based on each entry's mode.
      const entries = pendingRestore.get(sessionId);
      if (!entries) return;
      pendingRestore.delete(sessionId);

      for (const entry of entries) {
        if (entry.mode === "detached") {
          // Detached mode: answer arrives as a user message.
          // Accumulate until ALL detached prompts are answered.
          store.replaceResolve(sessionId, entry.id, (value) => {
            if (value === null) return;
            const list = detachedAccum.get(sessionId) ?? [];
            list.push(value);
            detachedAccum.set(sessionId, list);

            // Entry already removed — count remaining.
            if (countPendingDetached(sessionId) === 0) {
              flushDetached(sessionId);
            }
          });
        } else {
          // Bound mode: answer is injected as a tool result.
          store.replaceResolve(sessionId, entry.id, (value) => {
            if (value !== null) {
              helpers.injectToolResult(
                entry.toolCallId ?? entry.id,
                entry.toolName ?? "ask_user",
                value,
              );
            }
          });
        }
      }
    },

    onRemove(ctx: ToolSetContext): void {
      const key = ctxKey(ctx);
      store.removeSession(key);
      pendingRestore.delete(key);
      sendMessageByKey.delete(key);
      detachedAccum.delete(key);
    },

    onReset(ctx: ToolSetContext): void {
      const key = ctxKey(ctx);
      store.resetSession(key);
      detachedAccum.delete(key);
    },

    // ── Persistence ─────────────────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext) {
      const prompts = store.serialize(ctxKey(ctx));
      return prompts.length ? { pendingUserInputs: prompts } : {};
    },
  } as ToolSet;
  return { toolSet, slotDeclarations };
}
