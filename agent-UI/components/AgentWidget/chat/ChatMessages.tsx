import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ReactElement } from 'react';
import type { Message } from '../types';
import type { Attachment, DataAttachment } from '@agent-type';
import type { SlotSession } from '@agent-type';
import { ToolCallCard } from './ToolCallCard';
import { UserNote } from './UserNote';
import { AgentSection } from './AgentSection';
import { InlineEditor } from './InlineEditor';
import { DocumentSearch } from './DocumentSearch';
import { collectMatches } from './search';
import styles from '../AgentWidget.module.scss';

const NEAR_BOTTOM_THRESHOLD = 120;

interface ChatMessagesProps {
  messages: Message[];
  /** Called when the user edits a message and clicks "Save & Resend". */
  onEditMessage?: (messageId: string, newText: string, attachments?: readonly Attachment[]) => void;
  /** Session for app slot shouldRender evaluation. */
  readonly session: SlotSession;
}

/** Returns true when the scroll container is close enough to the bottom. */
function isNearBottom(container: HTMLElement): boolean {
  return container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_THRESHOLD;
}

export function ChatMessages({ messages, onEditMessage, session }: ChatMessagesProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef<number>(-1);

  // ── Follow mode (VS Code Copilot-style smart scroll) ─────────────────────
  // shouldFollowRef: true → auto-scroll with new content; false → user scrolled up
  // Using a ref (not state) avoids re-renders during high-frequency streaming.
  const shouldFollowRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // ── Edit state ───────────────────────────────────────────────────────────
  // messageId of the message currently being edited, or null when idle.
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Search state ─────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  /** Bumped on explicit next/prev so only user navigation triggers scrolling. */
  const [navTick, setNavTick] = useState(0);

  // ── Virtual list ─────────────────────────────────────────────────────────

  // Pre-filter invisible messages so the virtualizer index always maps to a
  // rendered item (empty non-streaming assistant bubbles are skipped).
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          !(
            m.role === 'assistant' &&
            !m.isStreaming &&
            m.content === '' &&
            !m.thinking &&
            !m.attachments?.length
          ),
      ),
    [messages],
  );

  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => containerRef.current,
    // Initial estimate; ResizeObserver via measureElement corrects it per item.
    estimateSize: () => 80,
    overscan: 5,
    paddingStart: 14,
    paddingEnd: 14,
    gap: 10,
    getItemKey: (i) => visibleMessages[i].id,
  });

  // On mount: instantly jump to the last message and reset follow mode.
  useEffect(() => {
    shouldFollowRef.current = true;
    if (visibleMessages.length > 0) {
      virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end', behavior: 'auto' });
    }
    prevCountRef.current = visibleMessages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track whether the user has scrolled away from the bottom (follow mode).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const near = isNearBottom(container);
      shouldFollowRef.current = near;
      setShowScrollBtn(!near);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || visibleMessages.length === 0) return;

    const prevCount = prevCountRef.current;
    prevCountRef.current = visibleMessages.length;

    const lastMsg = visibleMessages[visibleMessages.length - 1];
    const isStreaming = lastMsg?.isStreaming ?? false;

    if (isStreaming) {
      // During streaming: only follow if the user hasn't scrolled away.
      if (shouldFollowRef.current) {
        virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end', behavior: 'auto' });
      }
    } else if (visibleMessages.length > prevCount) {
      // New message appended: smooth scroll only if following.
      if (shouldFollowRef.current) {
        virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end', behavior: 'smooth' });
      }
    }
  }, [visibleMessages, virtualizer]);

  const scrollToBottom = useCallback(() => {
    virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end', behavior: 'smooth' });
    shouldFollowRef.current = true;
    setShowScrollBtn(false);
  }, [virtualizer, visibleMessages.length]);

  const virtualItems = virtualizer.getVirtualItems();

  // ── Search matches & navigation ───────────────────────────────────────────
  const matches = useMemo(() => collectMatches(visibleMessages, query), [visibleMessages, query]);
  const matchCount = matches.length;
  const currentMatch = matchCount > 0 ? matches[matchIndex % matchCount] : null;
  const currentMatchKey = currentMatch
    ? `${currentMatch.messageId}:${currentMatch.matchIndex}`
    : null;

  const jumpToMatch = useCallback(
    (forward: boolean): void => {
      if (matchCount === 0) return;
      setMatchIndex((prev) => (prev + (forward ? 1 : -1) + matchCount) % matchCount);
      setNavTick((tick) => tick + 1);
      shouldFollowRef.current = false;
    },
    [matchCount],
  );

  const closeSearch = useCallback((): void => {
    setSearchOpen(false);
    setQuery('');
    setMatchIndex(0);
    setNavTick(0);
    shouldFollowRef.current = true;
  }, []);

  // Scroll the current match into view only after explicit user navigation.
  useEffect(() => {
    if (navTick === 0 || !currentMatch) return;
    const targetIndex = visibleMessages.findIndex((m) => m.id === currentMatch.messageId);
    if (targetIndex < 0) return;
    virtualizer.scrollToIndex(targetIndex, { align: 'center', behavior: 'auto' });

    const key = `${currentMatch.messageId}:${currentMatch.matchIndex}`;
    const timers: number[] = [];
    const reveal = (): void => {
      const el = containerRef.current?.querySelector<HTMLElement>(`[data-match-key="${key}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (timers.length < 15) timers.push(window.setTimeout(reveal, 60));
    };
    timers.push(window.setTimeout(reveal, 30));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [navTick, currentMatch, visibleMessages, virtualizer]);

  // Ctrl/Cmd+F opens the search bar when the panel itself has focus.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const active = document.activeElement;
        if (active && containerRef.current?.contains(active)) {
          e.preventDefault();
          setSearchOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleEditSave = useCallback(
    (messageId: string, text: string, attachments?: readonly DataAttachment[]): void => {
      onEditMessage?.(messageId, text, attachments);
      setEditingId(null);
    },
    [onEditMessage],
  );

  return (
    <div className={styles['messages-wrap']}>
      {visibleMessages.length > 0 && (
        <DocumentSearch
          open={searchOpen}
          query={query}
          onQueryChange={(q) => {
            setQuery(q);
            setMatchIndex(0);
          }}
          matchIndex={matchCount > 0 ? matchIndex % matchCount : -1}
          matchCount={matchCount}
          onPrev={() => jumpToMatch(false)}
          onNext={() => jumpToMatch(true)}
          onClose={closeSearch}
          onOpen={() => setSearchOpen(true)}
        />
      )}
      <div className={styles['messages']} ref={containerRef}>
        {visibleMessages.length === 0 ? (
          <p className={styles['empty']}>Ask me anything to get started.</p>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((vItem) => {
              const message = visibleMessages[vItem.index];
              const isEditing = editingId === message.id;

              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                    boxSizing: 'border-box',
                  }}
                >
                  {message.role === 'tool' && message.toolCall ? (
                    <ToolCallCard info={message.toolCall} session={session} />
                  ) : message.role === 'user' ? (
                    isEditing ? (
                      <InlineEditor
                        key={message.id}
                        initialText={message.content}
                        initialAttachments={(message.attachments ?? []).filter(
                          (a): a is DataAttachment => a.source === 'data',
                        )}
                        onSave={(text, attachments) =>
                          handleEditSave(message.id, text, attachments)
                        }
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <UserNote
                        message={message}
                        query={query}
                        currentMatchKey={currentMatchKey}
                        onEdit={() => setEditingId(message.id)}
                      />
                    )
                  ) : (
                    <AgentSection
                      message={message}
                      query={query}
                      currentMatchKey={currentMatchKey}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showScrollBtn && (
        <button
          type="button"
          className={styles['scroll-to-bottom']}
          onClick={scrollToBottom}
          aria-label="Jump to latest message"
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  );
}
