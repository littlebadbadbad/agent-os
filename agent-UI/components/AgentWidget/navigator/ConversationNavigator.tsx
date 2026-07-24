/**
 * navigator/ConversationNavigator.tsx — Reusable list↔panel navigator.
 *
 * Switches between a list view (no active session) and a panel view
 * (active session selected).  A ChatInput is always rendered at the
 * bottom.
 *
 *   - **List view:**  Sending a message calls `onCreateSession`.
 *   - **Panel view:** Sending a message calls `activeSession.sendMessage`.
 *
 * Loading state is read reactively from the active session handle,
 * so the parent never needs to track `isLoading` or `enableAttachments`.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Attachment } from '@agent-type';
import type { ConversationItem } from './types';
import { SessionList } from './SessionList';
import { SessionPanel } from './SessionPanel';
import { ChatInput } from '../chat/ChatInput';
import styles from './styles.module.scss';

// ── SessionHandle ─────────────────────────────────────────────────────────────

/** Lightweight handle wrapping a session or sub-agent conversation.
 *  `ConversationNavigator` reads reactive state (`isLoading`, etc.)
 *  through `subscribe`/`getState` internally, so the parent never
 *  passes loading flags separately. */
export interface SessionHandle {
  readonly id: string;
  readonly title: string;
  readonly subscribe: (fn: () => void) => () => void;
  readonly getState: () => { readonly isLoading: boolean; readonly enableAttachments?: boolean };
  readonly sendMessage: (text: string, attachments?: readonly Attachment[]) => Promise<void>;
  readonly cancelMessage: () => void;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ConversationNavigatorProps {
  /** Active session (non-null → panel view; null → list view). */
  readonly activeSession: SessionHandle | null;

  /** All sessions for the list view. */
  readonly items: readonly ConversationItem[];
  readonly listTitle: string;
  readonly emptyState: ReactNode;

  /** Renders the panel content (messages + plugin slots). */
  readonly renderPanel: (id: string) => ReactNode;

  /** Called when user selects an item from the list. */
  readonly onSelect: (id: string) => void;
  /** Called when user presses the back button in panel view. */
  readonly onBack: () => void;
  readonly onDelete: (id: string) => void;
  /** Rename a session: title + subtitle. */
  readonly onRename: (id: string, title: string, subtitle: string) => void;

  /** Called when user sends a message from list view (creates new session). */
  readonly onCreateSession: (text: string, attachments?: readonly Attachment[]) => Promise<string | void>;
}

// ── Reactive session-state hook ───────────────────────────────────────────────

function useSessionProp<T>(session: SessionHandle | null, read: (s: SessionHandle) => T, fallback: T): T {
  const subscribe = useCallback(
    (cb: () => void) => session ? session.subscribe(cb) : (() => {}),
    [session],
  );
  const getSnapshot = () => session ? read(session) : fallback;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConversationNavigator(props: ConversationNavigatorProps): ReactElement {
  const {
    activeSession,
    items,
    listTitle,
    emptyState,
    renderPanel,
    onSelect,
    onBack,
    onDelete,
    onRename,
    onCreateSession,
  } = props;

  // Reactive loading & attachment state from the active session.
  const isLoading = useSessionProp(activeSession, (s) => s.getState().isLoading, false);
  const enableAttachments = useSessionProp(activeSession, (s) => s.getState().enableAttachments ?? true, true);

  const handleSend = useCallback(
    (text: string, attachments?: readonly Attachment[]) => {
      if (activeSession) {
        activeSession.sendMessage(text, attachments);
      } else {
        onCreateSession(text, attachments);
      }
    },
    [activeSession, onCreateSession],
  );

  const handleCancel = useCallback(() => {
    activeSession?.cancelMessage();
  }, [activeSession]);

  return (
    <div className={styles['navigator']}>
      {activeSession ? (
        <SessionPanel title={activeSession.title} onBack={onBack}>
          {renderPanel(activeSession.id)}
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
        onCancel={handleCancel}
        isLoading={isLoading}
        enableAttachments={enableAttachments}
      />
    </div>
  );
}
