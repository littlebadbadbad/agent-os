/**
 * SubAgentsPanel — UI for browsing and chatting with sub-agents managed
 * by one or more SubAgentRegistry instances.
 *
 * Layout (single registry):
 *   ┌──────────────┬──────────────────────────────────────────────────┐
 *   │  Agent list  │  Conversation tabs  ·  Header bar  ·  Panel      │
 *   │  (sidebar)   │  ChatMessages                                    │
 *   │              │  ChatInput                                        │
 *   └──────────────┴──────────────────────────────────────────────────┘
 *
 * When multiple registries are present a top-level tab bar selects the
 * active registry before showing the above layout.
 */

import { useState, useCallback, useSyncExternalStore, useMemo } from 'react';
import type { ReactElement } from 'react';
import type { Attachment, SubAgentRegistry, SubAgentEntrySnapshot } from '@agent-sdk';
import { agentMessagesToUI } from '@agent-sdk';
import { assistantMsg } from '../helpers';
import { ChatMessages } from '../chat/ChatMessages';
import { ChatInput } from '../chat/ChatInput';
import { createSubAgentSlotSession, discoverSubAgentSlots } from '../../../plugin/subAgentSlotSession';
import { PaneSlotLayout } from '../panes/PaneSlotLayout';
import { buildSlotDisplayContextFromState } from '../../../slots/context';
import type { HeaderBarSlotDeclaration, PanelSlotDeclaration, InlinePromptSlotDeclaration, SlotDisplayContext } from '@agent-type';
import styles from '../AgentWidget.module.scss';

// ── ConversationPane ─────────────────────────────────────────────────────────

interface ConversationPaneProps {
  registry: SubAgentRegistry;
  agentName: string;
  convId: string;
  sessionId: string;
}

function ConversationPane({ registry, agentName, convId, sessionId }: ConversationPaneProps): ReactElement | null {
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
  const headerBarSlots = useMemo<readonly { pluginId: string; declaration: HeaderBarSlotDeclaration }[]>(
    () => discoverSubAgentSlots(conv)
        .filter((e): e is { pluginId: string; declaration: HeaderBarSlotDeclaration } =>
          e.declaration.type === 'headerBar'),
    [conv],
  );
  const panelSlots = useMemo<readonly { pluginId: string; declaration: PanelSlotDeclaration }[]>(
    () => discoverSubAgentSlots(conv)
        .filter((e): e is { pluginId: string; declaration: PanelSlotDeclaration } =>
          e.declaration.type === 'panel' && e.declaration.showTab(slotCtx)),
    [conv],
  );
  const inlinePromptSlots = useMemo<readonly { pluginId: string; declaration: InlinePromptSlotDeclaration }[]>(
    () => discoverSubAgentSlots(conv)
        .filter((e): e is { pluginId: string; declaration: InlinePromptSlotDeclaration } =>
          e.declaration.type === 'inlinePrompt'),
    [conv],
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

  // Memoize UI message conversion so message IDs are stable between renders.
  // Without memoization, agentMessagesToUI creates fresh IDs on every render,
  // making the virtualizer remount all items and breaking edit targeting.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const baseMessages = useMemo(() => agentMessagesToUI(conv.history), [conv.history]);
  const messages = conv.isLoading
    ? [...baseMessages, assistantMsg('__subagent_stream__', conv.streamingText, true)]
    : baseMessages;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleEditMessage = useCallback(
    async (messageId: string, newText: string, attachments?: readonly Attachment[]) => {
      // Translate stable UI message ID → 1-based user message count in fullHistory.
      const msgIndex = baseMessages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;
      let userCount = 0;
      for (let i = 0; i <= msgIndex; i++) {
        if (baseMessages[i].role === 'user') userCount++;
      }
      if (userCount === 0) return;
      await registry.editConversationMessage(agentName, convId, userCount, newText, attachments);
    },
    [registry, agentName, convId, baseMessages],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
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

function RegistryView({ registry, sessionId }: RegistryViewProps): ReactElement {
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
    selectedConv && activeEntry.conversations.some((c) => c.id === selectedConv)
      ? selectedConv
      : activeEntry.activeConversationId;

  function selectAgent(name: string): void {
    setSelectedAgent(name);
    // Reset conversation selection when switching agents.
    setSelectedConv(null);
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* ── Agent sidebar ───────────────────────────────────────────────── */}
      <div
        style={{
          width: 140,
          flexShrink: 0,
          borderRight: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
          overflowY: 'auto',
          padding: '4px 0',
        }}
      >
        {subAgents.map((entry) => {
          const isActive = entry.name === activeEntry.name;
          const runningCount = entry.conversations.filter((c) => c.isLoading).length;
          return (
            <button
              key={entry.name}
              type="button"
              className={`${styles['tab']}${isActive ? ` ${styles['tab--active']}` : ''}`}
              style={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0 }}
              onClick={() => selectAgent(entry.name)}
              title={entry.description}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {entry.name}
              </span>
              {runningCount > 0 && (
                <span className={styles['tab-badge']} style={{ marginLeft: 4 }}>●</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Right pane: conversation tabs + chat ────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
        {/* Conversation tab bar */}
        {activeEntry.conversations.length > 1 && (
          <div className={styles['tab-bar']} style={{ flexShrink: 0 }}>
            {activeEntry.conversations.map((conv) => (
              <div
                key={conv.id}
                className={`${styles['tab']}${conv.id === activeConvId ? ` ${styles['tab--active']}` : ''}`}
              >
                <button
                  type="button"
                  className={styles['tab-label']}
                  onClick={() => setSelectedConv(conv.id)}
                  title={conv.title}
                >
                  <span style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                    {conv.title}
                  </span>
                  {conv.isLoading && (
                    <span className={styles['tab-badge']}>●</span>
                  )}
                </button>
                <button
                  type="button"
                  className={styles['tab-close']}
                  onClick={() => registry.deleteConversation(activeEntry.name, conv.id)}
                  title={`Close "${conv.title}"`}
                >
                  ×
                </button>
              </div>
            ))}
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
  registries: readonly SubAgentRegistry[];
  sessionId: string;
}

export function SubAgentsPanel({ registries, sessionId }: SubAgentsPanelProps): ReactElement {
  const [activeRegistryIdx, setActiveRegistryIdx] = useState(0);

  if (registries.length === 0) {
    return (
      <div className={styles['tools-empty']}>
        No sub-agent registries available.
      </div>
    );
  }

  const clampedIdx = Math.min(activeRegistryIdx, registries.length - 1);
  const activeRegistry = registries[clampedIdx];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Registry selector — only shown when multiple registries exist */}
      {registries.length > 1 && (
        <div className={styles['tab-bar']} style={{ flexShrink: 0 }}>
          {registries.map((reg, idx) => (
            <button
              key={idx}
              type="button"
              className={`${styles['tab']}${idx === clampedIdx ? ` ${styles['tab--active']}` : ''}`}
              onClick={() => setActiveRegistryIdx(idx)}
            >
              {reg.label}
            </button>
          ))}
        </div>
      )}

      <RegistryView
        key={clampedIdx}
        registry={activeRegistry}
        sessionId={sessionId}
      />
    </div>
  );
}
