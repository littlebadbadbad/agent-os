/**
 * extensions/user-input/agent/toolSet.ts — UserInput ToolSet
 *
 * Lifecycle hooks that:
 *   1. Inject `requestUserInput`/`cancelUserInput` into ToolExecutionContext (onPatchToolContext)
 *   2. Expose prompt state + responder via `onGetSymbolState` (symbol-isolated)
 *   3. Declare inlinePrompt slot for UI injection
 *   4. Handle session lifecycle (init/ready/remove/reset) and persistence
 *
 * Ported from plugins/user-input/index.js with full TypeScript typing.
 * KEY CHANGE: onGetState → onGetSymbolState for plugin state isolation.
 */

import type {
  ToolSet,
  ToolSetContext,
  ToolContextPatch,
  SessionEntryData,
  UserInputRequest,
  PluginUiAdapter,
  PluginSlotDeclaration,
  SlotDisplayContext,
} from "@agent-type";
import { createUserInputStore } from "./store";
import { askUserTool } from "./askUser";
import type { UserInputStore } from "./types";
import type { UserInputAdapter, InlinePromptEntry } from "./types";

// ── Symbol ────────────────────────────────────────────────────────────────────

export const USER_INPUT_SYMBOL: unique symbol = Symbol("user-input");

// ── Symbol-state shape ────────────────────────────────────────────────────────

/**
 * Shape exposed via `onGetSymbolState`.
 * Host reads from `sessionState[USER_INPUT_SYMBOL]`.
 *
 * Extends {@link PluginUiAdapter} so the host's `SlotRegistry` discovers
 * the `inlinePrompt` slot declaration.
 */
export interface UserInputSymbolState extends PluginUiAdapter {
  readonly type: "requestUserInput";
  readonly pendingUserInputs: ReadonlyArray<InlinePromptEntry>;
  readonly respondUserInput: (id: string, value: string | null) => void;
  readonly slots: readonly PluginSlotDeclaration[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toInlinePromptEntry(
  id: string,
  request: UserInputRequest,
  conversationId: string,
  agentName: string,
): InlinePromptEntry {
  const base: Pick<InlinePromptEntry, "id" | "conversationId" | "agentName"> = {
    id,
    conversationId,
    agentName,
  };

  switch (request.type) {
    case "confirm":
      return { ...base, kind: "confirm", message: request.message };
    case "text":
      return {
        ...base,
        kind: "text",
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
        kind: "select",
        message: request.message,
        options: request.options,
      };
    case "multiSelect":
      return {
        ...base,
        kind: "multiSelect",
        message: request.message,
        options: request.options,
        minSelect: request.minSelect,
        maxSelect: request.maxSelect,
      };
    case "number":
      return {
        ...base,
        kind: "number",
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
      // @ts-expect-error: exhaustive check
      return { ...base, kind: "text", message: request.message };
  }
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface UserInputToolSetOptions {
  /** Optional adapter for external prompt handling (headless mode). */
  readonly adapter?: UserInputAdapter | undefined;
  /**
   * External store instance (default: factory creates its own).
   * Pass in when you need cross-toolset composite conditions.
   */
  readonly store?: UserInputStore | undefined;
  /**
   * Override for inlinePrompt `shouldRender`.
   * Receives sessionId → returns a () => boolean.
   * Use to combine multiple toolset states (e.g. "show if either has content").
   */
  readonly shouldRenderInlinePrompt: (ctx: SlotDisplayContext) => boolean;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createUserInputToolSet(
  options: UserInputToolSetOptions = { shouldRenderInlinePrompt: () => false },
): ToolSet {
  const { adapter, shouldRenderInlinePrompt } = options;
  const store = options.store ?? createUserInputStore();

  // Ghost holders for prompts restored from snapshots before sendMessage is ready.
  const ghostHolders = new Map<
    string,
    Map<string, { fn: (value: string | null) => void }>
  >();

  function key(ctx: ToolSetContext): string {
    return ctx.sessionId;
  }

  // ── onPatchToolContext (injects requestUserInput) ───────────────────────────

  const patchFn: ToolContextPatch = (
    ctx: ToolSetContext,
    signal: AbortSignal,
  ) => {
    const sessionId = key(ctx);

    return {
      requestUserInput: (
        req: UserInputRequest,
        id?: string,
      ): Promise<string | null> =>
        new Promise<string | null>((resolve) => {
          const entryId = id ?? crypto.randomUUID();
          const prompt = toInlinePromptEntry(
            entryId,
            req,
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

  // Attach the comment property used by AI tool search.
  patchFn.comment =
    "`context.requestUserInput(request, id?)` → `Promise<string | null>` — suspend tool execution until the user responds to a chat prompt.\n" +
    "`context.cancelUserInput?(id)` — cancel a pending prompt programmatically.";

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
        "- **confirm** — yes/no question. Returns `\"yes\"` or signals cancellation.",
        "- **text** — free-form answer. Use only when the response cannot be constrained.",
        "- **select** — pick one from a fixed list. Prefer this over text when the valid answers are known.",
        "- **multiSelect** — pick one or more options. Returns a JSON array string.",
        "- **number** — numeric input. Specify `min`/`max`/`step` to constrain.",
        "",
        "Tool execution is **suspended** until the user responds. If the user cancels, the tool",
        "returns a cancellation message — proceed with a fallback strategy rather than retrying.",
      ].join("\n");
    },

    // ── State (symbol-isolated) ──────────────────────────────────────────────

    onGetSymbolState(ctx: ToolSetContext) {
      const sessionKey = key(ctx);
      return {
        type: "requestUserInput" as const,
        pendingUserInputs: store.getAll(sessionKey),
        respondUserInput: store.getResponder(sessionKey),
        slots: [
          {
            type: "inlinePrompt" as const,
            id: "user-input.prompt",
            shouldRender: shouldRenderInlinePrompt,
          },
        ],
      };
    },

    // ── Subscriptions ────────────────────────────────────────────────────────

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return store.subscribe(key(ctx), fn);
    },

    // ── onPatchToolContext ───────────────────────────────────────────────────

    onPatchToolContext: patchFn,

    // ── Session lifecycle ───────────────────────────────────────────────────

    onInitSession(ctx: ToolSetContext, entryData: SessionEntryData): void {
      if (adapter) return;
      const saved = entryData.pendingUserInputs;
      if (!saved?.length) return;

      const sessionId = key(ctx);
      let holders = ghostHolders.get(sessionId);
      if (!holders) {
        holders = new Map();
        ghostHolders.set(sessionId, holders);
      }

      for (const entry of saved) {
        const holder: { fn: (value: string | null) => void } = {
          fn: () => {},
        };
        holders.set(entry.id, holder);
        store.addGhost(sessionId, entry, (v) => holder.fn(v));
      }
    },

    onSessionReady(
      ctx: ToolSetContext,
      sendMessage: (text: string) => void,
    ): void {
      if (adapter) return;

      const sessionId = key(ctx);
      const holders = ghostHolders.get(sessionId);
      if (!holders) return;

      for (const holder of holders.values()) {
        holder.fn = (v: string | null) => {
          if (v !== null) sendMessage(v);
        };
      }
      ghostHolders.delete(sessionId);
    },

    onRemoveSession(ctx: ToolSetContext): void {
      store.removeSession(key(ctx));
    },

    onResetSession(ctx: ToolSetContext): void {
      store.resetSession(key(ctx));
    },

    // ── Persistence ─────────────────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext): {
      pendingUserInputs?: readonly InlinePromptEntry[];
    } {
      const prompts = store.serialize(key(ctx));
      return prompts.length ? { pendingUserInputs: prompts } : {};
    },
  };
}
