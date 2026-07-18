import { useSyncExternalStore, useState, useCallback, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Attachment } from '@agent-sdk';
import type { WidgetIcon, WidgetTheme, SessionManager, SessionListEntry } from '@agent-sdk';
import { Widget } from '../../Widget';
import { AIControlBar } from '../../Sidebar/AIControlBar';
import { SessionContent } from './SessionContent';
import { ConversationNavigator, formatTimeAgo } from '../navigator';
import type { ConversationItem, SessionHandle } from '../navigator';
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
  const { sessions } = useSyncExternalStore(
    sessionManager.subscribe,
    sessionManager.getState,
    sessionManager.getState,
  );

  const [panelSessionId, setPanelSessionId] = useState<string | undefined>();

  // The session currently shown in the panel view.
  const panelEntry = panelSessionId
    ? sessions.find((s) => s.id === panelSessionId)
    : undefined;
  const panelSession = panelEntry?.session;
  const agentId = sessions[0]?.session.getState().agentId;

  // Build reactive SessionHandle — ConversationNavigator subscribes
  // internally so the parent never passes isLoading/enableAttachments.
  const activeSession: SessionHandle | null = useMemo(
    () => panelEntry
      ? {
          id: panelEntry.id,
          title: panelEntry.title,
          subscribe: panelEntry.session.subscribe.bind(panelEntry.session),
          getState: () => {
            const s = panelEntry.session.getState();
            return { isLoading: s.isLoading, enableAttachments: s.enableAttachments ?? true };
          },
          sendMessage: panelEntry.session.sendMessage.bind(panelEntry.session),
          cancelMessage: panelEntry.session.cancelMessage.bind(panelEntry.session),
        }
      : null,
    [panelEntry],
  );

  // Build list items (no isLoading — that's on SessionHandle).
  const items: readonly ConversationItem[] = useMemo(
    () => sessions.map((s: SessionListEntry) => ({
      id: s.id,
      title: s.title,
      subtitle: formatTimeAgo(s.createdAt),
    })),
    [sessions],
  );

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

  const handleCreateSession = useCallback(
    async (text: string, attachments?: readonly Attachment[]) => {
      const session = sessionManager.createSession();
      const newId = session.getState().id;
      setPanelSessionId(newId);
      await session.sendMessage(text, attachments);
    },
    [sessionManager],
  );

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
            activeSession={activeSession}
            items={items}
            listTitle="Sessions"
            emptyState={<WelcomeState />}
            renderPanel={renderPanel}
            onSelect={handleSelect}
            onBack={handleBack}
            onDelete={handleDelete}
            onRename={handleRename}
            onCreateSession={handleCreateSession}
          />
        </div>
      </Widget>
    </PluginProvider>
  );
}
