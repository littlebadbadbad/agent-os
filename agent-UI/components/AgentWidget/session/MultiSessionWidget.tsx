import { useSyncExternalStore, useState, useCallback, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Attachment } from '@agent-sdk';
import type { WidgetIcon, WidgetTheme, SessionManager, SessionListEntry } from '@agent-sdk';
import { AIControlBar } from '../../Sidebar/AIControlBar';
import { SessionContent } from './SessionContent';
import { ConversationNavigator } from '../navigator';
import type { ConversationItem, SessionHandle } from '../navigator';
import styles from '../AgentWidget.module.scss';
import { PluginProvider, useSlotRegistry } from '../../../plugin/PluginContext';
import { DesktopLayout } from '../../DesktopLayout/DesktopLayout';

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

// ── Inner layout — rendered inside PluginProvider ──────────────────────────

import type { SlotSession } from "@agent-type";

function DesktopLayoutShell({
  icon,
  theme,
  panelSession,
  agentId,
  activeSession,
  items,
  renderPanel,
  onSelect,
  onBack,
  onDelete,
  onRename,
  onCreateSession,
}: {
  icon?: WidgetIcon;
  theme?: WidgetTheme;
  panelSession: SlotSession | null;
  agentId: string | undefined;
  activeSession: SessionHandle | null;
  items: readonly ConversationItem[];
  renderPanel: (id: string) => ReactNode;
  onSelect: (id: string) => void;
  onBack: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string, subtitle: string) => void;
  onCreateSession: (text: string, attachments?: readonly Attachment[]) => Promise<void>;
}): ReactElement {
  const { getByType } = useSlotRegistry();
  const appSlots = useMemo(() => getByType("app"), [getByType]);

  return (
    <DesktopLayout
      appSlots={appSlots}
      session={panelSession}
      sidebarId={agentId}
      sidebarIcon={icon}
      sidebarTheme={theme}
      sidebarControlBar={<AIControlBar activeSession={panelSession} />}
    >
      <ConversationNavigator
        activeSession={activeSession}
        items={items}
        listTitle="Sessions"
        emptyState={<WelcomeState />}
        renderPanel={renderPanel}
        onSelect={onSelect}
        onBack={onBack}
        onDelete={onDelete}
        onRename={onRename}
        onCreateSession={onCreateSession}
      />
    </DesktopLayout>
  );
}

// ── MultiSessionWidget ────────────────────────────────────────────────────────

export function MultiSessionWidget({
  icon,
  theme,
  sessionManager,
}: {
  icon?: WidgetIcon;
  theme?: WidgetTheme;
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

  const items: readonly ConversationItem[] = useMemo(
    () => sessions.map((s: SessionListEntry) => ({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      updatedAt: s.updatedAt,
      isLoading: s.session.getState().isLoading,
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
    (id: string, title: string, subtitle: string) => {
      sessionManager.renameSession(id, title, subtitle);
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
      <DesktopLayoutShell
        icon={icon}
        theme={theme}
        panelSession={panelSession ?? null}
        agentId={agentId}
        activeSession={activeSession}
        items={items}
        renderPanel={renderPanel}
        onSelect={handleSelect}
        onBack={handleBack}
        onDelete={handleDelete}
        onRename={handleRename}
        onCreateSession={handleCreateSession}
      />
    </PluginProvider>
  );
}
