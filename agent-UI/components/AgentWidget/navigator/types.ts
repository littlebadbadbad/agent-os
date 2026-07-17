/**
 * navigator/types.ts — Shared types for the ConversationNavigator family.
 */

import type { ReactNode } from 'react';
import type { Attachment } from '@agent-sdk';

/** A single entry in the session/conversation list. */
export interface ConversationItem {
  readonly id: string;
  readonly title: string;
  /** Human-readable age, e.g. "2 min ago", "1 hour ago". */
  readonly subtitle: string;
  readonly isLoading?: boolean;
}

/** Props shared between list-view and panel-view renderers. */
export interface NavigatorRenderProps {
  readonly items: readonly ConversationItem[];
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onBack: () => void;
  readonly onDelete: (id: string) => void;
  readonly onRename: (id: string, title: string) => void;
  readonly listTitle: string;
  readonly emptyState: ReactNode;
  readonly renderPanel: (id: string) => ReactNode;
  readonly onSendMessage: (text: string, attachments?: readonly Attachment[]) => void;
  readonly onCancel: () => void;
  readonly isLoading: boolean;
  readonly enableAttachments?: boolean;
}
