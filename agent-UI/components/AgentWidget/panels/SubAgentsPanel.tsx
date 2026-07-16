/**
 * SubAgentsPanel — UI for browsing and chatting with sub-agents.
 *
 * A session has exactly one sub-agent registry.  The panel renders a
 * {@link SubAgentsPanel} that shows the agent list on the left and the
 * active conversation's chat on the right.
 *
 * Layout:
 *   ┌──────────────┬──────────────────────────────────────────────────┐
 *   │  Agent list  │  Conversation tabs  ·  Header bar  ·  Panel      │
 *   │  (sidebar)   │  ChatMessages                                    │
 *   │              │  ChatInput                                        │
 *   └──────────────┴──────────────────────────────────────────────────┘
 */

import { useState, useCallback, useSyncExternalStore, useMemo } from 'react';
import type { ReactElement } from 'react';
import type { Attachment, SubAgentRegistry, SubAgentEntrySnapshot } from '@agent-sdk';
import { ChatMessages } from '../chat/ChatMessages';
import { ChatInput } from '../chat/ChatInput';
import { createSubAgentSlotSession, discoverSubAgentSlots } from '../../../plugin/subAgentSlotSession';
import { PaneSlotLayout } from '../panes/PaneSlotLayout';
import { buildSlotDisplayContextFromState } from '../../../slots/context';
import type { SlotDisplayContext, PanelSlotDeclaration } from '@agent-type';
import type { SlotEntry } from '../../../slots/registry';
import { usePluginSystem } from '../../../plugin/PluginContext';
import styles from '../AgentWidget.module.scss';

// ── ConversationPane ─────────────────────────────────────────────────────────

interface ConversationPaneProps {
  registry: SubAgentRegistry;
  agentName: string;
  convId: string;
  sessionId: string;
}

function ConversationPane({ registry, agentName, convId, sessionId }: ConversationPaneProps): ReactElement | null {
  const { activePlugins } = usePluginSystem();
  const rawConv = registry.getConversation(agentName, convId);
  // If the conversation doesn't exist, render nothing.
  if (!rawConv) return null;

  // Slot display context for this sub-agent conversation.
  const slotCtx: SlotDisplayContext = useMemo(
    () => buildSlotDisplayContextFromState({ id: sessionId, agentName, conversationId: convId }),
    [sessionId, agentName, convId],
  );

  const subscribe = useMemo(
    () => rawConv.subscribe.bind(rawConv),
    [rawConv],
  );
  const getState = useMemo(
    () => rawConv.getState.bind(rawConv),
    [rawConv],
  );

  // Subscribe to per-conversation state reactively.
  const conv = useSyncExternalStore(subscribe, getState, getState);

  // Create a SlotSession adapter for this conversation.
  const slotSession = useMemo(
    () => createSubAgentSlotSession(rawConv),
    [rawConv],
  );

  // Discover plugin slots from the conversation state.
  const headerBarSlots = useMemo<readonly SlotEntry[]>(
    () => discoverSubAgentSlots(conv, activePlugins)
        .filter((e) => e.declaration.type === 'headerBar'),
    [conv, activePlugins],
  );
  const panelSlots = useMemo<readonly SlotEntry[]>(
    () => discoverSubAgentSlots(conv, activePlugins)
        .filter((e) => e.declaration.type === 'panel' && e.declaration.showTab(slotCtx)),
    [conv, activePlugins],
  ) as readonly SlotEntry<PanelSlotDeclaration>[];
  const inlinePromptSlots = useMemo<readonly SlotEntry[]>(
    () => discoverSubAgentSlots(conv, activePlugins)
        .filter((e) => e.declaration.type === 'inlinePrompt' && e.declaration.shouldRender?.(slotCtx) !== false),
    [conv, activePlugins, slotCtx],
  );

  const handleSend = useCallback(
    async (text: string, attachments?: readonly Attachment[]) => {
      await registry.sendConversationMessage(agentName, convId, text, attachments);
    },
    [registry, agentName, convId],
  );

  const handleCancel = useCallback(() => {
    registry.cancelConversationMessage(agentName, convId);
  }, [registry, agentName, convId]);

  // Messages come directly from the ConversationRunner's MessageList via the
  // conversation state — includes streaming messages (isStreaming: true),
  // thinking deltas, tool-call result bubbles, and attachments.  No need to
  // manually convert history or synthesise a streaming placeholder message.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const messages = conv.messages;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleEditMessage = useCallback(
    async (messageId: string, newText: string, attachments?: readonly Attachment[]) => {
      // Translate stable UI message ID → 1-based user message count in fullHistory.
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
    <div className={styles['conversation-pane-wrap']}>
      <PaneSlotLayout
        slotSession={slotSession}
        headerBarSlots={headerBarSlots}
        panelSlots={panelSlots}
        inlinePromptSlots={inlinePromptSlots}
        slotCtx={slotCtx}
      >
        <ChatMessages messages={messages} onEditMessage={handleEditMessage} session={slotSession} />
        <ChatInput
          onSend={handleSend}
          onCancel={handleCancel}
          isLoading={conv.isLoading}
          enableAttachments={true}
        />
      </PaneSlotLayout>
    </div>
  );
}

// ── RegistryView ─────────────────────────────────────────────────────────────

interface RegistryViewProps {
  registry: SubAgentRegistry;
  sessionId: string;
}

export function SubAgentsPanel({ registry, sessionId }: RegistryViewProps): ReactElement {
  // Stable callbacks — memoised on `registry` identity so React's
  // useSyncExternalStore correctly re-subscribes only when the registry changes.
  const subscribe = useMemo(() => registry.subscribe.bind(registry), [registry]);
  const getState  = useMemo(() => registry.getState.bind(registry),  [registry]);

  const { subAgents } = useSyncExternalStore(subscribe, getState, getState);

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<string | null>(null);

  if (subAgents.length === 0) {
    return (
      <div className={styles['tools-empty']}>
        No sub-agents yet. Ask the agent to create one.
      </div>
    );
  }

  // Derive active agent + conversation with fallbacks.
  const activeAgentName: string = selectedAgent ?? subAgents[0].name;
  const activeEntry: SubAgentEntrySnapshot | undefined = subAgents.find(
    (a) => a.name === activeAgentName,
  ) ?? subAgents[0];

  const activeConvId: string =
    selectedConv && activeEntry.conversations.some((c) => c.conversationId === selectedConv)
      ? selectedConv
      : activeEntry.activeConversationId;

  function selectAgent(name: string): void {
    setSelectedAgent(name);
    // Reset conversation selection when switching agents.
    setSelectedConv(null);
  }

  return (
    <div className={styles['registry-view-wrap']}>
      {/* ── Agent sidebar ───────────────────────────────────────────────── */}
      <div className={styles['agent-sidebar']}
      >
        {subAgents.map((entry) => {
          const isActive = entry.name === activeEntry.name;
          const runningCount = entry.conversations.filter((c) => c.isLoading).length;
          return (
            <button
              key={entry.name}
              type="button"
              className={`${styles['agent-sidebar-tab']}${isActive ? ` ${styles['agent-sidebar-tab--active']}` : ''}`}
              onClick={() => selectAgent(entry.name)}
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

      {/* ── Right pane: conversation tabs + chat ────────────────────────── */}
      <div className={styles['agent-conversation-pane']}>
        {/* Conversation tab bar */}
        {activeEntry.conversations.length > 0 && (
          <div className={styles['tab-bar']}>
            {activeEntry.conversations.map((conv) => (
              <div
                key={conv.conversationId}
                className={`${styles['tab']}${conv.conversationId === activeConvId ? ` ${styles['tab--active']}` : ''}`}
              >
                <button
                  type="button"
                  className={styles['tab-label']}
                  onClick={() => setSelectedConv(conv.conversationId)}
                  title={conv.title}
                >
                  <span className={styles['tab-label-text']}>
                    {conv.title}
                  </span>
                  {conv.isLoading && (
                    <span className={styles['tab-badge']}>●</span>
                  )}
                </button>
                <button
                  type="button"
                  className={styles['tab-close']}
                  onClick={() => {
                    if (conv.conversationId === selectedConv) setSelectedConv(null);
                    registry.deleteConversation(activeEntry.name, conv.conversationId);
                  }}
                  title={`Close "${conv.title}"`}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles['conversation-tab-new']}
              onClick={() => {
                const newConv = registry.createConversation(activeEntry.name);
                setSelectedConv(newConv.getState().conversationId);
              }}
              title="New conversation"
            >
              +
            </button>
          </div>
        )}

        {/* Keyed so React fully remounts when the conversation changes. */}
        <ConversationPane
          key={`${activeEntry.name}::${activeConvId}`}
          registry={registry}
          agentName={activeEntry.name}
          convId={activeConvId}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}

// ── SubAgentsPanel (public export) ───────────────────────────────────────────

export interface SubAgentsPanelProps {
  /** The single per-session sub-agent registry (never null when this is rendered). */
  registry: SubAgentRegistry;
  sessionId: string;
}

