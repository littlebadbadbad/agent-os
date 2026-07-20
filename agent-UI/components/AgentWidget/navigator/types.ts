/**
 * navigator/types.ts — Shared types for the ConversationNavigator family.
 */

/** A single entry in the session/conversation list. */
export interface ConversationItem {
  readonly id: string;
  readonly title: string;
  /**
   * User-editable subtitle; empty string means hidden.
   * This is NOT the time-ago — that is computed from `updatedAt`.
   */
  readonly subtitle: string;
  /** ISO timestamp of last activity — for sorting and relative-time display. */
  readonly updatedAt: string;
  /** Whether this session is currently processing a turn. */
  readonly isLoading?: boolean;
}

/** Display fallback for sessions/conversations without a custom title yet. */
export const DISPLAY_NEW_CHAT = 'New Chat' as const;

/**
 * Returns the title for display — defaults to "New Chat" when no custom
 * title has been set (empty string).
 */
export function displayTitle(title: string): string {
  return title || DISPLAY_NEW_CHAT;
}
