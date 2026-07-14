import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Attachment, DataAttachment } from '@agent-sdk';
import type { AutocompleteItem } from '@agent-type';
import { MAX_FILE_BYTES, ACCEPTED_MIME_TYPES, fileToDataAttachment } from './fileAttachment';
import { SendIcon, StopIcon, AttachIcon } from './ChatInputIcons';
import { slotRegistry } from '../../../slots/registry';
import styles from '../AgentWidget.module.scss';

interface ChatInputProps {
  onSend: (text: string, attachments?: readonly Attachment[]) => void;
  /**
   * Whether the agent loop is currently running.
   * When true, the Stop button is shown in place of the Send button so the
   * user can abort the run.
   */
  isLoading?: boolean;
  /** Called when the user clicks the stop button during a loading state. */
  onCancel?: () => void;
  /** When false, hides the attach-file button entirely. Defaults to true. */
  enableAttachments?: boolean;
}

export function ChatInput({ onSend, isLoading = false, onCancel, enableAttachments = true }: ChatInputProps): ReactElement {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<DataAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Autocomplete state ──────────────────────────────────────────────────
  const [acOpen, setAcOpen] = useState(false);
  const [acItems, setAcItems] = useState<AutocompleteItem[]>([]);
  const [acIndex, setAcIndex] = useState(0);
  const [acPrefix, setAcPrefix] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Build prefix → items map from all autocomplete slots.
  // Read directly from slotRegistry on each render so plugin slots registered
  // after mount (via pluginSystem.refreshSlots) are picked up reactively.
  const prefixItemsMap = (() => {
    const map = new Map<string, AutocompleteItem[]>();
    for (const slot of slotRegistry.getByType('autocomplete')) {
      const prefix = slot.declaration.prefix;
      const items = slot.declaration.getItems({
        sessionId: '',
        agentName: 'main',
        conversationId: 'main',
      });
      if (items.length > 0) {
        const existing = map.get(prefix);
        map.set(prefix, existing ? [...existing, ...items] : [...items]);
      }
    }
    return map;
  })();

  const hasAcSlots = prefixItemsMap.size > 0;

  // Keep selected index in range when items change
  useEffect(() => {
    setAcIndex((prev) => Math.min(prev, Math.max(0, acItems.length - 1)));
  }, [acItems.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (acOpen && menuRef.current) {
      const items = menuRef.current.querySelectorAll('[data-ac-item]');
      items[acIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [acIndex, acOpen]);

  /** Insert the selected autocomplete item into the input. */
  const selectItem = useCallback((item: AutocompleteItem) => {
    setValue(item.insertText);
    setAcOpen(false);
    setAcItems([]);
    setAcPrefix('');
    // Re-focus and place cursor at end
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  }, []);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);

    setValue('');
    setAttachments([]);
    setAttachError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, attachments, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      // ── Autocomplete navigation ────────────────────────────────────────
      if (acOpen && acItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setAcIndex((i) => (i + 1) % acItems.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setAcIndex((i) => (i - 1 + acItems.length) % acItems.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const item = acItems[acIndex];
          if (item) selectItem(item);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setAcOpen(false);
          setAcItems([]);
          setAcPrefix('');
          setValue('');
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit, acOpen, acItems, acIndex, selectItem],
  );

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>): void => {
    const newValue = e.target.value;
    setValue(newValue);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;

    // Multi-prefix autocomplete detection
    if (hasAcSlots) {
      const matchedPrefix = Array.from(prefixItemsMap.keys())
        .filter((p) => newValue.startsWith(p))
        .sort((a, b) => b.length - a.length)[0]; // longest prefix wins

      if (matchedPrefix) {
        const filterText = newValue.slice(matchedPrefix.length);
        const allItems = prefixItemsMap.get(matchedPrefix)!;
        const filtered = allItems.filter(
          (item) => item.label.toLowerCase().includes(filterText.toLowerCase()),
        );
        setAcOpen(true);
        setAcItems(filtered);
        setAcPrefix(matchedPrefix);
        setAcIndex(0);
        return;
      }
    }

    if (acOpen) {
      setAcOpen(false);
      setAcItems([]);
      setAcPrefix('');
    }
  }, [hasAcSlots, prefixItemsMap, acOpen]);

  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    // Reset so the same file can be re-selected
    e.target.value = '';
    if (files.length === 0) return;

    setAttachError(null);
    const oversized = files.find((f) => f.size > MAX_FILE_BYTES);
    if (oversized) {
      setAttachError(`"${oversized.name}" exceeds the 20 MB limit.`);
      return;
    }

    try {
      const converted = await Promise.all(files.map(fileToDataAttachment));
      setAttachments((prev) => [...prev, ...converted]);
    } catch {
      setAttachError('Failed to read one or more files.');
    }
  }, []);

  const removeAttachment = useCallback((index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const canSend = value.trim().length > 0 || attachments.length > 0;

  return (
    <div className={styles['input-area']}>
      {/* Hidden file input */}
      {enableAttachments && (
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_MIME_TYPES}
          multiple
          className={styles['hidden']}
          onChange={handleFileChange}
          aria-hidden="true"
          tabIndex={-1}
        />
      )}

      {/* Attachment preview strip */}
      {attachments.length > 0 && (
        <div className={styles['attach-strip']}>
          {attachments.map((att, i) => (
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
                onClick={() => removeAttachment(i)}
                aria-label={`Remove ${att.name ?? 'attachment'}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error notice */}
      {attachError && (
        <div className={styles['attach-error']} role="alert">{attachError}</div>
      )}

      {/* Autocomplete menu (multi-prefix) */}
      {acOpen && acItems.length > 0 && (
        <div ref={menuRef} className={styles['slash-menu']} role="listbox" aria-label="Autocomplete">
          <div className={styles['slash-menu-header']}>Autocomplete — type to filter</div>
          {acItems.map((item, i) => (
            <div
              key={item.id}
              data-ac-item
              role="option"
              aria-selected={i === acIndex}
              className={`${styles['slash-item']}${i === acIndex ? ` ${styles['slash-item--active']}` : ''}`}
              onMouseEnter={() => setAcIndex(i)}
              onClick={() => selectItem(item)}
            >
              <span className={styles['slash-item-prefix']}>{item.label}</span>
              <div className={styles['slash-item-content']}>
                <span className={styles['slash-item-desc']}>{item.description}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles['input-row']}>
        {/* Attach file button */}
        {enableAttachments && (
          <button
            type="button"
            className={styles['attach-btn']}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            title="Attach image or document"
          >
            <AttachIcon />
          </button>
        )}

        <textarea
          ref={textareaRef}
          className={styles['input']}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask something… (Shift+Enter for new line)"
          rows={1}
          aria-label="Message input"
        />

        {isLoading && onCancel ? (
          <button
            type="button"
            className={styles['stop-btn']}
            onClick={onCancel}
            aria-label="Stop"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className={styles['send-btn']}
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  );
}


