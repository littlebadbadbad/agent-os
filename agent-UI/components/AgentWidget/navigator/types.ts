/**
 * navigator/types.ts — Shared types for the ConversationNavigator family.
 */

/** A single entry in the session/conversation list. */
export interface ConversationItem {
  readonly id: string;
  readonly title: string;
  /** Human-readable age, e.g. "2 min ago", "1 hour ago". */
  readonly subtitle: string;
}
