import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Attachment, DataAttachment, AutocompleteItem, AutocompleteSlotDeclaration, SlotDisplayContext } from '@agent-type';
import { MAX_FILE_BYTES, ACCEPTED_MIME_TYPES, fileToDataAttachment } from './fileAttachment';
import { SendIcon, StopIcon, AttachIcon } from './ChatInputIcons';
import { useSlotRegistry } from '../../../app/AppContext';
import styles from '../AgentWidget.module.scss';

/** When the autocomplete item count exceeds this, a dedicated search input appears. */
const AC_SEARCH_THRESHOLD = 8;

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
  /** Start offset of the text to be replaced when an item is selected. */
  const [acReplaceStart, setAcReplaceStart] = useState(0);
  /** Snapshot of the input value before autocomplete opened (for Escape restore). */
  const acRestoreRef = useRef('');
  const menuRef = useRef<HTMLDivElement>(null);
  /** Dedicated search query when the dropdown has many items. */
  const [acSearch, setAcSearch] = useState('');
  const [acShowSearch, setAcShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Collect all autocomplete slots with their current items.
  const { getByType } = useSlotRegistry();
  const displayCtx: SlotDisplayContext = {
    sessionId: '',
    agentName: 'main',
    conversationId: 'main',
  };
  const acSlots: ReadonlyArray<{ declaration: AutocompleteSlotDeclaration; items: readonly AutocompleteItem[] }> = (() => {
    const slots = getByType('autocomplete');
    const result: Array<{ declaration: AutocompleteSlotDeclaration; items: readonly AutocompleteItem[] }> = [];
    for (const slot of slots) {
      const items = slot.declaration.getItems(displayCtx);
      if (items.length > 0) {
        result.push({ declaration: slot.declaration, items });
      }
    }
    return result;
  })();

  const hasAcSlots = acSlots.length > 0;

  // When the dropdown has many items, a dedicated search input further filters
  // by both label and description.  Otherwise the textarea-typed filter suffices.
  const acDisplayedItems = useMemo(() => {
    if (acShowSearch && acSearch) {
      const q = acSearch.toLowerCase();
      return acItems.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q),
      );
    }
    return acItems;
  }, [acShowSearch, acSearch, acItems]);

  // Keep selected index in range when displayed items change
  useEffect(() => {
    setAcIndex((prev) => Math.min(prev, Math.max(0, acDisplayedItems.length - 1)));
  }, [acDisplayedItems.length]);

  // Reset selection to first item when search query changes
  useEffect(() => {
    if (acSearch) setAcIndex(0);
  }, [acSearch]);

  // Auto-focus the search input when it appears
  useEffect(() => {
    if (acOpen && acShowSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [acOpen, acShowSearch]);

  // Scroll selected item into view
  useEffect(() => {
    if (acOpen && menuRef.current) {
      const items = menuRef.current.querySelectorAll('[data-ac-item]');
      items[acIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [acIndex, acOpen]);

  /** Insert the selected autocomplete item into the input (inline replacement). */
  const selectItem = useCallback((item: AutocompleteItem) => {
    setValue((prev) => {
      const ta = textareaRef.current;
      const cursor = ta ? ta.selectionStart : prev.length;
      // Replace text from acReplaceStart to cursor with insertText.
      const next = prev.slice(0, acReplaceStart) + item.insertText + prev.slice(cursor);
      // Place caret right after the inserted text.
      const newCursor = acReplaceStart + item.insertText.length;
      requestAnimationFrame(() => {
        if (ta) {
          ta.focus();
          ta.setSelectionRange(newCursor, newCursor);
        }
      });
      return next;
    });
    setAcOpen(false);
    setAcItems([]);
    setAcIndex(0);
    setAcSearch('');
    setAcShowSearch(false);
  }, [acReplaceStart]);

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
      if (acOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          // Restore the input to its pre-autocomplete state.
          setValue(acRestoreRef.current);
          setAcOpen(false);
          setAcItems([]);
          setAcIndex(0);
          setAcSearch('');
          setAcShowSearch(false);
          requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (ta) {
              ta.focus();
              const end = acRestoreRef.current.length;
              ta.setSelectionRange(end, end);
            }
          });
          return;
        }
        if (acDisplayedItems.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAcIndex((i) => (i + 1) % acDisplayedItems.length);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAcIndex((i) => (i - 1 + acDisplayedItems.length) % acDisplayedItems.length);
            return;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const item = acDisplayedItems[acIndex];
            if (item) selectItem(item);
            return;
          }
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit, acOpen, acDisplayedItems, acIndex, selectItem],
  );

  /** Keyboard navigation when the dedicated search input is focused. */
  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setValue(acRestoreRef.current);
        setAcOpen(false);
        setAcItems([]);
        setAcIndex(0);
        setAcSearch('');
        setAcShowSearch(false);
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (ta) {
            ta.focus();
            const end = acRestoreRef.current.length;
            ta.setSelectionRange(end, end);
          }
        });
        return;
      }
      if (acDisplayedItems.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcIndex((i) => (i + 1) % acDisplayedItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcIndex((i) => (i - 1 + acDisplayedItems.length) % acDisplayedItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const item = acDisplayedItems[acIndex];
        if (item) selectItem(item);
        return;
      }
    },
    [acDisplayedItems, acIndex, selectItem],
  );

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>): void => {
    const newValue = e.target.value;
    const cursor = e.target.selectionStart ?? newValue.length;
    setValue(newValue);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;

    // Autocomplete trigger detection — ask each slot whether it wants to open.
    if (hasAcSlots) {
      const triggerCtx = {
        value: newValue,
        cursor,
        textBefore: newValue.slice(0, cursor),
      };

      // Collect ALL matching slots — their items are stacked (concatenated),
      // not overwritten.  Slots are registered in priority order so earlier
      // slots appear first in the dropdown.
      const matchedSlots: Array<{ items: readonly AutocompleteItem[]; replaceStart: number }> = [];
      for (const slot of acSlots) {
        const result = slot.declaration.shouldTrigger(triggerCtx);
        if (result !== false) {
          matchedSlots.push({ items: slot.items, replaceStart: result });
        }
      }

      if (matchedSlots.length > 0) {
        // All matching slots share the same trigger context, so their
        // replaceStart values should be identical.  Use the minimum as a
        // safety net in case a slot returns a different offset.
        const replaceStart = matchedSlots.reduce((min, s) => Math.min(min, s.replaceStart), Infinity);
        const allItems = matchedSlots.flatMap((s) => s.items);
        const showSearch = allItems.length > AC_SEARCH_THRESHOLD;

        if (showSearch) {
          // Many items — skip textarea filtering; the dedicated search input
          // inside the dropdown handles narrowing by label + description.
          if (!acOpen) acRestoreRef.current = newValue;
          setAcOpen(true);
          setAcItems(allItems);
          setAcReplaceStart(replaceStart);
          setAcIndex(0);
          setAcShowSearch(true);
          return;
        }

        // Few items — filter by the text typed after the trigger prefix.
        const filterText = newValue.slice(replaceStart, cursor);
        const filtered = allItems.filter(
          (item) => item.label.toLowerCase().includes(filterText.toLowerCase()),
        );
        if (!acOpen) acRestoreRef.current = newValue;
        setAcOpen(true);
        setAcItems(filtered);
        setAcReplaceStart(replaceStart);
        setAcIndex(0);
        setAcShowSearch(false);
        return;
      }
    }

    if (acOpen) {
      setAcOpen(false);
      setAcItems([]);
      setAcIndex(0);
      setAcSearch('');
      setAcShowSearch(false);
    }
  }, [hasAcSlots, acSlots, acOpen]);

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

      {/* Autocomplete menu */}
      {acOpen && (acDisplayedItems.length > 0 || acShowSearch) && (
        <div ref={menuRef} className={styles['slash-menu']} role="listbox" aria-label="Autocomplete">
          {acShowSearch ? (
            <div className={styles['slash-search']}>
              <input
                ref={searchInputRef}
                type="text"
                className={styles['slash-search-input']}
                placeholder="Search…"
                value={acSearch}
                onChange={(e) => setAcSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                aria-label="Search autocomplete items"
              />
            </div>
          ) : (
            <div className={styles['slash-menu-header']}>Autocomplete — type to filter</div>
          )}
          {acDisplayedItems.length > 0 ? (
            acDisplayedItems.map((item, i) => (
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
            ))
          ) : (
            <div className={styles['slash-empty']}>No matching items</div>
          )}
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


