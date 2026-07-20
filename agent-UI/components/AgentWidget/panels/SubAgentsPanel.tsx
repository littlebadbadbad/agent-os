/**
 * SubAgentsPanel — UI for browsing and chatting with sub-agents.
 *
 * A session has exactly one sub-agent registry.  The panel renders an agent
 * sidebar on the left and a {@link ConversationNavigator} on the right that
 * shows the selected agent's conversations in a list↔panel pattern — the
 * same navigator component used by the main agent.
 *
 * Layout:
 *   ┌──────────────┬──────────────────────────────────────────────────┐
 *   │  Agent list  │  ConversationNavigator                          │
 *   │  (sidebar)   │  ├─ [list] Conversation list + ChatInput        │
 *   │              │  └─ [panel] Back · ChatMessages + ChatInput     │
 *   └──────────────┴──────────────────────────────────────────────────┘
 */

import { useState, useCallback, useSyncExternalStore, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Attachment, SubAgentRegistry, SubAgentEntrySnapshot, SubAgentConversationState } from '@agent-sdk';
import type { SlotDisplayContext, PanelSlotDeclaration, SlotSession } from '@agent-type';
import type { SlotEntry } from '../../../slots/registry';
import { ChatMessages } from '../chat/ChatMessages';
import { ConversationNavigator, formatTimeAgo } from '../navigator';
import type { ConversationItem, SessionHandle } from '../navigator';
import { createSubAgentSlotSession, discoverSubAgentSlots } from '../../../plugin/subAgentSlotSession';
import { PaneSlotLayout } from '../panes/PaneSlotLayout';
import { buildSlotDisplayContextFromState } from '../../../slots/context';
import { usePluginSystem } from '../../../plugin/PluginContext';
import styles from '../AgentWidget.module.scss';

// ── ConversationChat ─────────────────────────────────────────────────────────
// Renders the messages and plugin slots for a single sub-agent conversation
// (without ChatInput — that lives in ConversationNavigator).

interface ConversationChatProps {
  registry: SubAgentRegistry;
  agentName: string;
  convId: string;
  sessionId: string;
}

function ConversationChat({ registry, agentName, convId, sessionId }: ConversationChatProps): ReactElement | null {
  const { activePlugins } = usePluginSystem();
  const rawConv = registry.getConversation(agentName, convId);
  if (!rawConv) return null;

  const slotCtx: SlotDisplayContext = useMemo(
    () => buildSlotDisplayContextFromState({ id: sessionId, agentName, conversationId: convId }),
    [sessionId, agentName, convId],
  );

  const subscribe = useMemo(() => rawConv.subscribe.bind(rawConv), [rawConv]);
  const getState = useMemo(() => rawConv.getState.bind(rawConv), [rawConv]);
  const conv = useSyncExternalStore(subscribe, getState, getState);

  const slotSession: SlotSession = useMemo(() => createSubAgentSlotSession(rawConv), [rawConv]);

  const headerBarSlots = useMemo<readonly SlotEntry[]>(
    () => discoverSubAgentSlots(conv, activePlugins).filter((e) => e.declaration.type === 'headerBar'),
    [conv, activePlugins],
  );
  const panelSlots = useMemo<readonly SlotEntry<PanelSlotDeclaration>[]>(
    () => discoverSubAgentSlots(conv, activePlugins)
      .filter((e): e is SlotEntry<PanelSlotDeclaration> => e.declaration.type === 'panel' && e.declaration.showTab(slotCtx)),
    [conv, activePlugins, slotCtx],
  );
  const inlinePromptSlots = useMemo<readonly SlotEntry[]>(
    () => discoverSubAgentSlots(conv, activePlugins)
      .filter((e) => e.declaration.type === 'inlinePrompt' && e.declaration.shouldRender?.(slotCtx) !== false),
    [conv, activePlugins, slotCtx],
  );

  const messages = conv.messages;

  const handleEditMessage = useCallback(
    async (messageId: string, newText: string, attachments?: readonly Attachment[]) => {
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;
      let userCount = 0;
      for (let i = 0; i <= msgIndex; i++) {
        if (messages[i].role === 'user') userCount++;
      }
      if (userCount === 0) return;
      await registry.editConversationMessage(agentName, convId, userCount, newText, attachments);
    },
    [registry, agentName, convId, messages],
  );

  return (
    <PaneSlotLayout
      slotSession={slotSession}
      headerBarSlots={headerBarSlots}
      panelSlots={panelSlots}
      inlinePromptSlots={inlinePromptSlots}
      slotCtx={slotCtx}
    >
      <ChatMessages messages={messages} onEditMessage={handleEditMessage} session={slotSession} />
    </PaneSlotLayout>
  );
}

// ── AgentNavigator ───────────────────────────────────────────────────────────
// Wraps a single sub-agent's conversations in a ConversationNavigator.

interface AgentNavigatorProps {
  registry: SubAgentRegistry;
  agentName: string;
  conversations: readonly SubAgentConversationState[];
  sessionId: string;
}

function AgentNavigator({ registry, agentName, conversations, sessionId }: AgentNavigatorProps): ReactElement {
  const items: readonly ConversationItem[] = useMemo(
    () => conversations.map((c) => ({
      id: c.conversationId,
      title: c.title,
      subtitle: formatTimeAgo(c.createdAt),
      isLoading: c.isLoading,
    })),
    [conversations],
  );

  const [selectedConvId, setSelectedConvId] = useState<string | undefined>();

  const selectedConv = selectedConvId
    ? conversations.find((c) => c.conversationId === selectedConvId)
    : undefined;

  // Build reactive SessionHandle — loading state flows through
  // subscribe/getState so ConversationNavigator doesn't need isLoading prop.
  const activeSession: SessionHandle | null = useMemo(() => {
    if (!selectedConv) return null;
    const rawConv = registry.getConversation(agentName, selectedConv.conversationId);
    if (!rawConv) return null;
    return {
      id: selectedConv.conversationId,
      title: selectedConv.title,
      subscribe: rawConv.subscribe.bind(rawConv),
      getState: () => ({ isLoading: selectedConv.isLoading, enableAttachments: false }),
      sendMessage: (text, attachments) =>
        registry.sendConversationMessage(agentName, selectedConv.conversationId, text, attachments),
      cancelMessage: () =>
        registry.cancelConversationMessage(agentName, selectedConv.conversationId),
    };
  }, [selectedConv, registry, agentName]);

  const handleSelect = useCallback((id: string) => {
    registry.setActiveConversation(agentName, id);
    setSelectedConvId(id);
  }, [registry, agentName]);

  const handleBack = useCallback(() => {
    setSelectedConvId(undefined);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      registry.deleteConversation(agentName, id);
      if (selectedConvId === id) setSelectedConvId(undefined);
    },
    [registry, agentName, selectedConvId],
  );

  const handleRename = useCallback(
    (_id: string, _title: string) => {
      // Sub-agent conversations are auto-titled; manual rename not supported.
    },
    [],
  );

  const handleCreateSession = useCallback(
    async (text: string, attachments?: readonly Attachment[]) => {
      const newConv = registry.createConversation(agentName);
      const newId = newConv.getState().conversationId;
      setSelectedConvId(newId);
      await registry.sendConversationMessage(agentName, newId, text, attachments);
    },
    [registry, agentName],
  );

  const renderPanel = useCallback(
    (id: string): ReactNode => (
      <ConversationChat
        key={`${agentName}::${id}`}
        registry={registry}
        agentName={agentName}
        convId={id}
        sessionId={sessionId}
      />
    ),
    [registry, agentName, sessionId],
  );

  return (
    <ConversationNavigator
      activeSession={activeSession}
      items={items}
      onSelect={handleSelect}
      onBack={handleBack}
      onDelete={handleDelete}
      onRename={handleRename}
      onCreateSession={handleCreateSession}
      listTitle={agentName}
      emptyState={
        <div className={styles['tools-empty']}>
          No conversations yet. Send a message to start one.
        </div>
      }
      renderPanel={renderPanel}
    />
  );
}

// ── SubAgentsPanel (public export) ───────────────────────────────────────────

export function SubAgentsPanel({
  registry,
  sessionId,
}: {
  registry: SubAgentRegistry;
  sessionId: string;
}): ReactElement {
  const subscribe = useMemo(() => registry.subscribe.bind(registry), [registry]);
  const getState = useMemo(() => registry.getState.bind(registry), [registry]);
  const { subAgents } = useSyncExternalStore(subscribe, getState, getState);

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  if (subAgents.length === 0) {
    return (
      <div className={styles['tools-empty']}>
        No sub-agents yet. Ask the agent to create one.
      </div>
    );
  }

  const activeEntry: SubAgentEntrySnapshot =
    subAgents.find((a) => a.name === (selectedAgent ?? subAgents[0].name)) ?? subAgents[0];

  return (
    <div className={styles['registry-view-wrap']}>
      {/* Agent sidebar */}
      <div className={styles['agent-sidebar']}>
        {subAgents.map((entry) => {
          const isActive = entry.name === activeEntry.name;
          const runningCount = entry.conversations.filter((c) => c.isLoading).length;
          return (
            <button
              key={entry.name}
              type="button"
              className={`${styles['agent-sidebar-tab']}${isActive ? ` ${styles['agent-sidebar-tab--active']}` : ''}`}
              onClick={() => setSelectedAgent(entry.name)}
              title={entry.description}
            >
              {entry.name}
              {runningCount > 0 && (
                <span className={`${styles['tab-badge']} ${styles['sidebar-tab-badge']}`}>●</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Conversation navigator */}
      <div className={styles['agent-conversation-pane']}>
        <AgentNavigator
          key={activeEntry.name}
          registry={registry}
          agentName={activeEntry.name}
          conversations={activeEntry.conversations}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}

export interface SubAgentsPanelProps {
  registry: SubAgentRegistry;
  sessionId: string;
}

