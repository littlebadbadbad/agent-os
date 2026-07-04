/**
 * SubAgentsPanel — UI for browsing and chatting with sub-agents managed
 * by one or more SubAgentRegistry instances.
 *
 * Layout (single registry):
 *   ┌──────────────┬──────────────────────────────────────────────────┐
 *   │  Agent list  │  Conversation tabs  ·  Token bar  ·  Todo        │
 *   │  (sidebar)   │  ChatMessages                                    │
 *   │              │  ChatInput                                        │
 *   └──────────────┴──────────────────────────────────────────────────┘
 *
 * When multiple registries are present a top-level tab bar selects the
 * active registry before showing the above layout.
 */

import { useState, useCallback, useSyncExternalStore, useMemo } from 'react';
import type { ReactElement } from 'react';
import type { Attachment, SubAgentRegistry, SubAgentConversationState, SubAgentEntrySnapshot, TodoItem } from '@agent-sdk';
import { agentMessagesToUI } from '@agent-sdk';
import { assistantMsg } from '../helpers';
import { ChatMessages } from '../chat/ChatMessages';
import { ChatInput } from '../chat/ChatInput';
import { TodoPanel } from './TodoPanel';
import { TokenProgressBar } from './TokenProgress';
import styles from '../AgentWidget.module.scss';

// ── ConversationPane ─────────────────────────────────────────────────────────

interface ConversationPaneProps {
  registry: SubAgentRegistry;
  agentName: string;
  convId: string;
  /** Todo items for this agent — shared across all its conversations. */
  todos: readonly TodoItem[];
}

function ConversationPane({ registry, agentName, convId, todos }: ConversationPaneProps): ReactElement {
  const rawConv = registry.getConversation(agentName, convId);

  // Stable fallbacks for useSyncExternalStore when the conversation handle is absent.
  // Defined outside the conditional so hook call count is always the same.
  const emptySubscribe = useMemo<(fn: () => void) => () => void>(() => (_fn) => () => {}, []);
  const emptyGetState  = useMemo<() => SubAgentConversationState | null>(() => () => null as unknown as SubAgentConversationState, []);

  const subscribe = useMemo(
    () => (rawConv ? rawConv.subscribe.bind(rawConv) : emptySubscribe),
    [rawConv, emptySubscribe],
  );
  const getState = useMemo(
    () => (rawConv ? rawConv.getState.bind(rawConv) : emptyGetState),
    [rawConv, emptyGetState],
  );

  // Subscribe to per-conversation state reactively.
  const conv = useSyncExternalStore(subscribe, getState, getState);

  const handleSend = useCallback(
    async (text: string, attachments?: readonly Attachment[]) => {
      await registry.sendConversationMessage(agentName, convId, text, attachments);
    },
    [registry, agentName, convId],
  );

  const handleCancel = useCallback(() => {
    registry.cancelConversationMessage(agentName, convId);
  }, [registry, agentName, convId]);

  if (!conv) {
    return <div className={styles['tools-empty']}>Conversation not found.</div>;
  }

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

  const showTodo = todos.length > 0;
  const showToken = conv.tokenBudget !== undefined && conv.tokenBudget.maxTokens > 0 && conv.tokenBudget.turnCount > 0;

  return (
    <div className={styles['chat-panel']}>
      {showToken && <TokenProgressBar state={conv.tokenBudget!} />}
      {showTodo && <TodoPanel todos={todos} />}
      <ChatMessages messages={messages} tokenBudget={conv.tokenBudget} onEditMessage={handleEditMessage} />
      <ChatInput
        onSend={handleSend}
        onCancel={handleCancel}
        isLoading={conv.isLoading}
        disabled={conv.isLoading}
        enableAttachments={true}
      />
    </div>
  );
}

// ── RegistryView ─────────────────────────────────────────────────────────────

interface RegistryViewProps {
  registry: SubAgentRegistry;
}

function RegistryView({ registry }: RegistryViewProps): ReactElement {
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
              <button
                key={conv.id}
                type="button"
                className={`${styles['tab']}${conv.id === activeConvId ? ` ${styles['tab--active']}` : ''}`}
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
            ))}
          </div>
        )}

        {/* Keyed so React fully remounts when the conversation changes. */}
        <ConversationPane
          key={`${activeEntry.name}::${activeConvId}`}
          registry={registry}
          agentName={activeEntry.name}
          convId={activeConvId}
          todos={activeEntry.todos ?? []}
        />
      </div>
    </div>
  );
}

// ── SubAgentsPanel (public export) ───────────────────────────────────────────

export interface SubAgentsPanelProps {
  registries: readonly SubAgentRegistry[];
}

export function SubAgentsPanel({ registries }: SubAgentsPanelProps): ReactElement {
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
          {registries.map((_, idx) => (
            <button
              key={idx}
              type="button"
              className={`${styles['tab']}${idx === clampedIdx ? ` ${styles['tab--active']}` : ''}`}
              onClick={() => setActiveRegistryIdx(idx)}
            >
              Registry {idx + 1}
            </button>
          ))}
        </div>
      )}

      <RegistryView
        key={clampedIdx}
        registry={activeRegistry}
      />
    </div>
  );
}
