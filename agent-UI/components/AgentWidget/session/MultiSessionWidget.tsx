import { useSyncExternalStore, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Attachment } from '@agent-sdk';
import type { WidgetIcon, WidgetTheme, SessionManager, SessionListEntry } from '@agent-sdk';
import { Widget } from '../../Widget';
import { AIControlBar } from '../../Sidebar/AIControlBar';
import { SessionContent } from './SessionContent';
import { ConversationNavigator, formatTimeAgo } from '../navigator';
import type { ConversationItem } from '../navigator';
import styles from '../AgentWidget.module.scss';
import { PluginProvider } from '../../../plugin/PluginContext';

// ── Welcome state (shown when no sessions exist) ──────────────────────────────

function WelcomeState(): ReactElement {
  return (
    <div className={styles['welcome']}>
      <div className={styles['welcome-icon']}>💬</div>
      <div className={styles['welcome-title']}>Start a conversation</div>
      <div className={styles['welcome-desc']}>
        Type a message below to begin a new chat with the agent.
      </div>
    </div>
  );
}

// ── MultiSessionWidget ────────────────────────────────────────────────────────

export function MultiSessionWidget({
  icon,
  theme,
  initialWidth,
  sessionManager,
}: {
  icon?: WidgetIcon;
  theme?: WidgetTheme;
  initialWidth?: number;
  sessionManager: SessionManager;
}): ReactElement {
  const { sessions, activeSessionId } = useSyncExternalStore(
    sessionManager.subscribe,
    sessionManager.getState,
    sessionManager.getState,
  );

  // ── Panel navigation state ──────────────────────────────────────────────
  // `panelSessionId` controls whether the navigator shows list (undefined) or
  // panel (set). Always start at the list view.
  const [panelSessionId, setPanelSessionId] = useState<string | undefined>(
    undefined,
  );

  // When an external action creates a session (e.g. SDK persistence restore),
  // navigate to its panel.  Only react to `activeSessionId` — do NOT depend
  // on `panelSessionId` so that user-initiated back-navigation is not overridden.
  const panelSessionRef = useRef(panelSessionId);
  panelSessionRef.current = panelSessionId;
  useEffect(() => {
    if (activeSessionId && activeSessionId !== panelSessionRef.current) {
      setPanelSessionId(activeSessionId);
    }
  }, [activeSessionId]);

  // Agent ID is stable (set once from config.id).
  const agentId = sessions[0]?.session.getState().agentId;

  // Build conversation items for the navigator.
  const items: readonly ConversationItem[] = useMemo(
    () => sessions.map((s: SessionListEntry) => ({
      id: s.id,
      title: s.title,
      subtitle: formatTimeAgo(s.createdAt),
      isLoading: s.session.getState().isLoading,
    })),
    [sessions],
  );

  // The session currently shown in the panel view.
  const panelEntry = panelSessionId
    ? sessions.find((s) => s.id === panelSessionId)
    : undefined;
  const panelSession = panelEntry?.session;
  const isPanelLoading = panelSession?.getState().isLoading ?? false;

  // ── Navigation handlers ─────────────────────────────────────────────────

  const handleSelect = useCallback(
    (id: string) => {
      sessionManager.setActiveSession(id);
      setPanelSessionId(id);
    },
    [sessionManager],
  );

  const handleBack = useCallback(() => {
    setPanelSessionId(undefined);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      sessionManager.removeSession(id);
      if (panelSessionId === id) setPanelSessionId(undefined);
    },
    [sessionManager, panelSessionId],
  );

  const handleRename = useCallback(
    (id: string, title: string) => {
      sessionManager.renameSession(id, title);
    },
    [sessionManager],
  );

  // ── Message sending ─────────────────────────────────────────────────────

  const handleSendMessage = useCallback(
    async (text: string, attachments?: readonly Attachment[]) => {
      if (panelSessionId && panelSession) {
        // Panel view: send to current session.
        await panelSession.sendMessage(text, attachments);
      } else {
        // List view: create new session and switch to panel.
        const session = sessionManager.createSession();
        setPanelSessionId(session.getState().id);
        await session.sendMessage(text, attachments);
      }
    },
    [panelSessionId, panelSession, sessionManager],
  );

  const handleCancel = useCallback(() => {
    panelSession?.cancelMessage();
  }, [panelSession]);

  // ── Render panel content ────────────────────────────────────────────────

  const renderPanel = useCallback(
    (id: string): ReactNode => {
      const entry = sessions.find((s) => s.id === id);
      if (!entry) return null;
      return (
        <SessionContent
          key={entry.id}
          session={entry.session}
          sessionId={entry.id}
        />
      );
    },
    [sessions],
  );

  return (
    <PluginProvider session={panelSession ?? null}>
      <Widget
        id={agentId}
        icon={icon}
        theme={theme}
        initialWidth={initialWidth}
        controlBar={panelSession ? <AIControlBar activeSession={panelSession} /> : undefined}
      >
        <div className={styles['chat']}>
          <ConversationNavigator
            items={items}
            selectedId={panelSessionId}
            onSelect={handleSelect}
            onBack={handleBack}
            onDelete={handleDelete}
            onRename={handleRename}
            listTitle="Sessions"
            emptyState={<WelcomeState />}
            renderPanel={renderPanel}
            onSendMessage={handleSendMessage}
            onCancel={handleCancel}
            isLoading={isPanelLoading}
            enableAttachments={panelSession?.getState().enableAttachments ?? true}
          />
        </div>
      </Widget>
    </PluginProvider>
  );
}
