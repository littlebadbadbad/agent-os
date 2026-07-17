/**
 * navigator/ConversationNavigator.tsx — Reusable list↔panel navigator.
 *
 * A self-contained component that shows EITHER a session/conversation list
 * OR a detail panel (never both).  A ChatInput is always rendered at the
 * bottom, changing its behaviour based on the current view:
 *
 *   - **List view:**  Sending a message creates a new session/conversation.
 *   - **Panel view:** Sending a message sends to the currently selected item.
 *
 * Designed to be used by both the main agent (MultiSessionWidget) and
 * sub-agents (SubAgentsPanel) — the only difference is the data source.
 *
 * Usage:
 * ```tsx
 * <ConversationNavigator
 *   items={sessions}
 *   selectedId={activeSessionId}
 *   onSelect={setActiveSession}
 *   onBack={() => setActiveSession(undefined)}
 *   onDelete={removeSession}
 *   onRename={renameSession}
 *   listTitle="Sessions"
 *   emptyState={<Welcome />}
 *   renderPanel={(id) => <SessionContent />}
 *   onSendMessage={handleSend}
 *   onCancel={handleCancel}
 *   isLoading={isLoading}
 * />
 * ```
 */

import { useCallback } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Attachment } from '@agent-sdk';
import type { ConversationItem } from './types';
import { SessionList } from './SessionList';
import { SessionPanel } from './SessionPanel';
import { ChatInput } from '../chat/ChatInput';
import styles from './styles.module.scss';

export interface ConversationNavigatorProps {
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

export function ConversationNavigator(props: ConversationNavigatorProps): ReactElement {
  const {
    items,
    selectedId,
    onSelect,
    onBack,
    onDelete,
    onRename,
    emptyState,
    renderPanel,
    onSendMessage,
    onCancel,
    isLoading,
    enableAttachments,
  } = props;

  const selectedItem = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;

  const handleSend = useCallback(
    (text: string, attachments?: readonly Attachment[]) => {
      onSendMessage(text, attachments);
    },
    [onSendMessage],
  );

  return (
    <div className={styles['navigator']}>
      {selectedItem ? (
        <SessionPanel item={selectedItem} onBack={onBack}>
          {renderPanel(selectedId!)}
        </SessionPanel>
      ) : (
        <div className={styles['navigator-list-wrap']}>
          <SessionList
            items={items}
            activeId={undefined}
            onSelect={onSelect}
            onDelete={onDelete}
            onRename={onRename}
            emptyState={emptyState}
          />
        </div>
      )}

      <ChatInput
        onSend={handleSend}
        onCancel={onCancel}
        isLoading={isLoading}
        enableAttachments={enableAttachments}
      />
    </div>
  );
}
