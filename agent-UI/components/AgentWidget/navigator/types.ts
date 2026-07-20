/**
 * navigator/types.ts — Shared types for the ConversationNavigator family.
 */

/** A single entry in the session/conversation list. */
export interface ConversationItem {
  readonly id: string;
  readonly title: string;
  /** Human-readable age, e.g. "2 min ago", "1 hour ago". */
  readonly subtitle: string;
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
