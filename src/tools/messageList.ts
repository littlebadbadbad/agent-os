/**
 * Reactive UI message store.
 *
 * Both the main agent session and sub-agent conversations drive their UI
 * message list through a single {@link MessageList} abstraction, eliminating
 * the duplicated setMessages / streamingText patterns that previously lived
 * in {@link AgentSession} and {@link SubAgentConversation}.
 *
 * The store holds a flat array of {@link Message} objects (the same type used
 * by React components throughout agent-UI) and notifies subscribers on every
 * mutation.  It is compatible with React's {@code useSyncExternalStore}.
 *
 * @module
 */

import type { ToolCallInfo } from '@agent-type';
import type { Attachment } from '@agent-type';

// ── Message type ──────────────────────────────────────────────────────────────

/**
 * UI-facing message — richer than `AgentMessage` because it carries
 * rendering metadata (id, streaming flag, tool-call status).
 *
 * Shared by both the main-agent session store and sub-agent conversations.
 */
export type Message = {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly isStreaming: boolean;
  /** Reasoning / thinking text shown in a collapsible block above the reply. */
  readonly thinking?: string;
  /** Present only when {@code role === 'tool'}. */
  readonly toolCall?: ToolCallInfo;
  /** Multimodal attachments attached by the user or produced by the model. */
  readonly attachments?: readonly Attachment[];
};

// ── Message constructors ──────────────────────────────────────────────────────

/** Create a user message for the UI store. */
export function userMsg(id: string, content: string, attachments?: readonly Attachment[]): Message {
  return { id, role: 'user', content, isStreaming: false, attachments };
}

/** Create an assistant message for the UI store. */
export function assistantMsg(id: string, content: string, streaming = false): Message {
  return { id, role: 'assistant', content, isStreaming: streaming };
}

/** Create a tool-result message for the UI store. */
export function toolMsg(info: ToolCallInfo): Message {
  return {
    id: info.toolCallId,
    role: 'tool',
    content: '',
    isStreaming: false,
    toolCall: info,
  };
}

// ── MessageList interface ─────────────────────────────────────────────────────

export type MessageListUpdater = (prev: Message[]) => Message[];

export interface MessageList {
  /** Snapshot of all current messages. */
  readonly messages: Message[];

  /** Number of messages currently in the store. */
  get length(): number;

  /** Append one or more messages at the end. */
  push(...msgs: Message[]): void;

  /**
   * Update a single message by its `id`.
   *
   * The `updater` receives the current message (or `undefined` when not found)
   * and must return the replacement.  Return the same reference to skip the
   * update.
   */
  update(id: string, updater: (msg: Message | undefined) => Message | undefined): void;

  /**
   * Replace the entire message list via a functional setter — mirrors
   * React's `setMessages((prev) => ...)` pattern exactly.
   */
  replace(fn: MessageListUpdater): void;

  /** Truncate the message list to the first `count` entries. */
  truncate(count: number): void;

  /** Find the index of the first message matching the predicate. */
  findIndex(predicate: (m: Message) => boolean): number;

  /**
   * Index of the last streaming assistant message, or -1 when none exists.
   * Used by onBeforeInvoke to determine where to inject queued user messages.
   */
  lastStreamingIndex(): number;

  /** Subscribe to mutations.  Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a reactive UI message store.
 *
 * @param initial  Optional starting messages (e.g. restored from persistence).
 */
export function createMessageList(initial?: readonly Message[]): MessageList {
  let messages: Message[] = initial ? [...initial] : [];
  const subs = new Set<() => void>();

  function notify(): void {
    for (const fn of subs) fn();
  }

  return {
    get messages(): Message[] {
      return messages;
    },

    get length(): number {
      return messages.length;
    },

    push(...msgs: Message[]): void {
      if (msgs.length === 0) return;
      messages = [...messages, ...msgs];
      notify();
    },

update(id: string, updater: (msg: Message | undefined) => Message | undefined): void {
    let changed = false;
    const next = messages.map((m) => {
      if (m.id === id) {
        const updated = updater(m);
        if (updated !== m) {
          if (updated === undefined) return m; // skip undefined returns
            changed = true;
            return updated;
          }
        }
        return m;
      });
      if (changed) {
        messages = next;
        notify();
      }
    },

    replace(fn: MessageListUpdater): void {
      const next = fn(messages);
      if (next === messages) return; // same reference = no change
      messages = [...next];
      notify();
    },

    truncate(count: number): void {
      if (count >= messages.length) return;
      messages = messages.slice(0, count);
      notify();
    },

    findIndex(predicate: (m: Message) => boolean): number {
      return messages.findIndex(predicate);
    },

    lastStreamingIndex(): number {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].isStreaming) return i;
      }
      return -1;
    },

    subscribe(fn: () => void): () => void {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
