/**
 * extensions/user-input/agent/toolSet.ts — UserInput ToolSet
 *
 * Lifecycle hooks that:
 *   1. Inject `requestUserInput`/`cancelUserInput`/`sendMessage` into
 *      ToolExecutionContext (onPatchToolContext)
 *   2. Expose prompt state + responder via `onGetSymbolState` (symbol-isolated)
 *   3. Declare inlinePrompt slot for UI injection
 *   4. Handle lifecycle (onInit/onReady/onReset/onRemove) and persistence
 *
 * All restored prompts resolve via injectToolResult (bound mode). The
 * ask_user tool always binds; answers are never sent as user messages.
 */

import {
  type ToolSet,
  type ToolSetContext,
  type ToolContextPatch,
  type SessionEntryData,
  type UserInputRequest,
  type SessionReadyHelpers,
  type Attachment,
  type PluginUiAdapter,
  type PluginSlotDeclaration,
  ctxKey,
} from "@agent-type";
import { createUserInputStore } from "./store";
import { askUserTool } from "./askUser";
import type { UserInputAdapter, InlinePromptEntry } from "./types";
import { UserInputPromptState } from "../types";

// ── Symbol ────────────────────────────────────────────────────────────────────

export const USER_INPUT_SYMBOL: unique symbol = Symbol("user-input");

// ── Symbol-state shape ────────────────────────────────────────────────────────

export interface UserInputSymbolState extends PluginUiAdapter {
  readonly type: "requestUserInput";
  readonly pendingUserInputs: ReadonlyArray<InlinePromptEntry>;
  readonly respondUserInput: (id: string, value: string | null) => void;
  readonly slots: readonly PluginSlotDeclaration[];
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

export function createUserInputToolSet(
  options: UserInputToolSetOptions = {},
): ToolSet<UserInputPromptState> {
  const { adapter } = options;
  const store = createUserInputStore();

  // Persisted entries that need to be wired once sendMessage is ready.
  // Keyed by sessionId → array of saved InlinePromptEntry.
  const pendingRestore = new Map<string, readonly InlinePromptEntry[]>();

  // `sendMessage` refs injected into onPatchToolContext.
  // Keyed by sessionId.
  const sendMessageByKey = new Map<string, (text: string) => void>();

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
        new Promise<string | null>((resolve) => {
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
          store.add(sessionId, { ...prompt, resolve });
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
        }),

      cancelUserInput: (id: string): void => {
        store.remove(sessionId, id, null);
      },
    };
  };

  patchFn.comment =
    "`context.requestUserInput(request, id?)` → `Promise<string | null>` — suspend tool execution until the user responds.\n" +
    "`context.cancelUserInput?(id)` — cancel a pending prompt programmatically.\n" +
    "`context.sendMessage?(text)` — send a user message into the conversation.";

  return {
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
        slots: [
          {
            type: "inlinePrompt" as const,
            shouldRender: (ctx) => store.getAll(ctxKey(ctx)).length > 0,
          },
        ],
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

      // Replace ghost resolves with injectToolResult (always bound mode).
      const entries = pendingRestore.get(sessionId);
      if (!entries) return;
      pendingRestore.delete(sessionId);

      for (const entry of entries) {
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
    },

    onRemove(ctx: ToolSetContext): void {
      const key = ctxKey(ctx);
      store.removeSession(key);
      pendingRestore.delete(key);
      sendMessageByKey.delete(key);
    },

    onReset(ctx: ToolSetContext): void {
      store.resetSession(ctxKey(ctx));
    },

    // ── Persistence ─────────────────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext) {
      const prompts = store.serialize(ctxKey(ctx));
      return prompts.length ? { pendingUserInputs: prompts } : {};
    },
  };
}
