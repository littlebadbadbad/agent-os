import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ReactElement, ChangeEvent, KeyboardEvent } from 'react';
import type { Message } from '../types';
import type { DataAttachment, Attachment } from '@agent-sdk';
import type { SlotSession } from '@agent-type';
import { MAX_FILE_BYTES, ACCEPTED_MIME_TYPES, fileToDataAttachment } from './fileAttachment';
import { ToolCallCard } from './ToolCallCard';
import { AttachmentList } from './AttachmentList';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownText } from './MarkdownText';
import { AttachIcon } from './ChatInputIcons';
import styles from '../AgentWidget.module.scss';

const NEAR_BOTTOM_THRESHOLD = 120;

interface ChatMessagesProps {
  messages: Message[];
  /** Called when the user edits a message and clicks "Save & Resend". */
  onEditMessage?: (messageId: string, newText: string, attachments?: readonly Attachment[]) => void;
  /** Session for plugin slot shouldRender evaluation. */
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
  const [editText, setEditText] = useState('');
  const [editAttachments, setEditAttachments] = useState<DataAttachment[]>([]);
  const [editAttachError, setEditAttachError] = useState<string | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback((message: Message) => {
    setEditingId(message.id);
    setEditText(message.content);
    // Pre-populate with any data attachments the user originally sent.
    const dataAtts = (message.attachments ?? []).filter(
      (a): a is DataAttachment => a.source === 'data',
    );
    setEditAttachments(dataAtts);
    setEditAttachError(null);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditText('');
    setEditAttachments([]);
    setEditAttachError(null);
  }, []);

  const handleEditFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setEditAttachError(null);
    const oversized = files.find((f) => f.size > MAX_FILE_BYTES);
    if (oversized) {
      setEditAttachError(`"${oversized.name}" exceeds the 20 MB limit.`);
      return;
    }
    try {
      const converted = await Promise.all(files.map(fileToDataAttachment));
      setEditAttachments((prev) => [...prev, ...converted]);
    } catch {
      setEditAttachError('Failed to read one or more files.');
    }
  }, []);

  const removeEditAttachment = useCallback((index: number): void => {
    setEditAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleEditKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Submit via the save button's onClick — handled below.
      const form = (e.target as HTMLElement).closest('[data-edit-form]');
      (form?.querySelector('[data-edit-save]') as HTMLButtonElement)?.click();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  }, [cancelEditing]);

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

  return (
    <div className={styles['messages-wrap']}>
      <div className={styles['messages']} ref={containerRef}>
      {/* Hidden file input for edit-form attachments — lives outside the
          virtualizer so the ref is stable across re-renders. */}
      <input
        ref={editFileInputRef}
        type="file"
        accept={ACCEPTED_MIME_TYPES}
        multiple
        style={{ display: 'none' }}
        onChange={handleEditFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
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
                {/* ── Tool call bubble ── */}
                {message.role === 'tool' && message.toolCall ? (
                  <ToolCallCard info={message.toolCall} session={session} />
                ) : (
                  /* ── Regular message bubble ── */
                  <div
                    className={`${styles['message']} ${styles[message.role]} ${isEditing ? styles['message--editing'] : ''}`}
                  >
                    {message.thinking && (
                      <ThinkingBlock text={message.thinking} isStreaming={!!message.isStreaming} />
                    )}
                    {/* Attachments rendered above the bubble for user messages */}
                    {message.role === 'user' && message.attachments && message.attachments.length > 0 && (
                      <AttachmentList attachments={message.attachments} />
                    )}
                    <div className={styles['bubble']}>
                      {/* ── Editing state: inline textarea ── */}
                      {isEditing ? (
                        <div className={styles['edit-form']} data-edit-form>
                          {/* Attachment preview strip */}
                          {editAttachments.length > 0 && (
                            <div className={styles['attach-strip']}>
                              {editAttachments.map((att, i) => (
                                <div key={i} className={styles['attach-chip']}>
                                  {att.kind === 'image' ? (
                                    <img
                                      src={`data:${att.mimeType};base64,${att.data}`}
                                      alt={att.name ?? 'attachment'}
                                      className={styles['attach-thumb']}
                                    />
                                  ) : (
                                    <span className={styles['attach-doc-icon']} aria-hidden="true">📄</span>
                                  )}
                                  <span className={styles['attach-name']}>{att.name ?? att.mimeType}</span>
                                  <button
                                    type="button"
                                    className={styles['attach-remove']}
                                    onClick={() => removeEditAttachment(i)}
                                    aria-label={`Remove ${att.name ?? 'attachment'}`}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {editAttachError && (
                            <div className={styles['attach-error']} role="alert">{editAttachError}</div>
                          )}
                          <textarea
                            className={styles['edit-textarea']}
                            value={editText}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditText(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            autoFocus
                            rows={Math.max(2, editText.split('\n').length)}
                          />
                          <div className={styles['edit-actions']}>
                            <button
                              type="button"
                              className={styles['edit-cancel-btn']}
                              onClick={cancelEditing}
                              data-edit-cancel
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className={styles['attach-btn']}
                              onClick={() => editFileInputRef.current?.click()}
                              aria-label="Attach file"
                              title="Attach image or document"
                            >
                              <AttachIcon />
                            </button>
                            <button
                              type="button"
                              className={styles['edit-save-btn']}
                              onClick={() => {
                                const trimmed = editText.trim();
                                if (!trimmed && editAttachments.length === 0) return;
                                onEditMessage?.(
                                  message.id,
                                  trimmed,
                                  editAttachments.length > 0 ? editAttachments : undefined,
                                );
                                setEditingId(null);
                                setEditText('');
                                setEditAttachments([]);
                                setEditAttachError(null);
                              }}
                              data-edit-save
                            >
                              Save & Resend
                            </button>
                          </div>
                        </div>
                      ) : message.isStreaming && message.content === '' && !message.thinking ? (
                        <span className={styles['thinking']} role="status" aria-label="Thinking">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : message.isStreaming && message.content === '' ? null : (
                        <MarkdownText text={message.content} isStreaming={message.isStreaming} />
                      )}

                      {/* Assistant-generated output attachments (e.g. generated images) */}
                      {message.role === 'assistant' && message.attachments && message.attachments.length > 0 && (
                        <AttachmentList attachments={message.attachments} />
                      )}
                    </div>

                    {/* ── Edit button: visible on hover for user messages ── */}
                    {message.role === 'user' && !isEditing && !message.isStreaming && (
                      <button
                        type="button"
                        className={styles['edit-btn']}
                        onClick={() => startEditing(message)}
                        title="Edit this message"
                        aria-label="Edit this message"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                    )}
                  </div>
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
