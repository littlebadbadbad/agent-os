/**
 * TagInput.tsx
 * ────────────
 * Multi-value tag chip editor with autocomplete.
 *
 * ADO stores tags as a semicolon-separated string: "tag1; tag2; tag3"
 * This component converts to/from that format internally.
 *
 * Features
 * ════════
 * • Renders each tag as a removable chip
 * • Type to filter suggestions from the `suggestions` prop
 * • Press Enter, Tab, or comma to commit the current input as a new tag
 * • Press Backspace on empty input to remove the last chip
 * • Click outside closes the dropdown
 * • Duplicate tags are silently ignored
 * • `disabled` mode prevents all edits
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
} from 'react';
import styles from './TagInput.module.scss';

// ── Serialization helpers ─────────────────────────────────────────────────────

/** Parse ADO semicolon-delimited tag string into a trimmed, non-empty array. */
export function parseTags(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Serialize a tag array into ADO format: "tag1; tag2; tag3". */
export function serializeTags(tags: string[]): string {
  return tags.join('; ');
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface TagInputProps {
  /** Controlled value in ADO semicolon format: "tag1; tag2; tag3" */
  value: string;
  /** Called when the committed tag set changes. Value is in ADO semicolon format. */
  onChange: (value: string) => void;
  /** Available tag names to suggest in the dropdown. */
  suggestions?: string[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** aria-label for the internal input. */
  ariaLabel?: string;
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  disabled = false,
  placeholder = '添加标签…',
  className,
  ariaLabel,
}: TagInputProps) {
  const [chips, setChips] = useState<string[]>(() => parseTags(value));
  const [inputText, setInputText] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Keep chips in sync with external value changes (e.g. programmatic set)
  useEffect(() => {
    setChips(parseTags(value));
  }, [value]);

  // Scroll highlighted suggestion into view
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const li = listRef.current?.children[activeIndex] as HTMLLIElement | undefined;
    li?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  // Click-outside to close dropdown
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        commitInput();
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputText, chips]);

  // Filtered suggestions: not yet selected, and matching the current input
  const filtered = suggestions.filter(
    (s) =>
      !chips.includes(s) &&
      (!inputText || s.toLowerCase().includes(inputText.toLowerCase())),
  );

  /** Commit the typed input as a new chip (if non-empty and not a duplicate). */
  const commitInput = useCallback(
    (text = inputText) => {
      const trimmed = text.trim();
      if (!trimmed || chips.includes(trimmed)) {
        setInputText('');
        return;
      }
      const next = [...chips, trimmed];
      setChips(next);
      onChange(serializeTags(next));
      setInputText('');
    },
    [chips, inputText, onChange],
  );

  const selectSuggestion = useCallback(
    (tag: string) => {
      if (chips.includes(tag)) return;
      const next = [...chips, tag];
      setChips(next);
      onChange(serializeTags(next));
      setInputText('');
      setOpen(false);
      inputRef.current?.focus();
    },
    [chips, onChange],
  );

  function removeChip(tag: string) {
    const next = chips.filter((c) => c !== tag);
    setChips(next);
    onChange(serializeTags(next));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputText(e.target.value);
    setOpen(true);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'Enter':
      case ',':
        e.preventDefault();
        if (open && activeIndex >= 0 && filtered[activeIndex]) {
          selectSuggestion(filtered[activeIndex]);
        } else {
          commitInput();
          setOpen(filtered.length > 0);
        }
        break;
      case 'Tab':
        if (inputText.trim()) {
          e.preventDefault();
          commitInput();
        }
        setOpen(false);
        break;
      case 'Backspace':
        if (!inputText && chips.length > 0) {
          removeChip(chips[chips.length - 1]);
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        setOpen(true);
        setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, -1));
        break;
      case 'Escape':
        setInputText('');
        setOpen(false);
        setActiveIndex(-1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${disabled ? styles.rootDisabled : ''} ${className ?? ''}`}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-owns={listId}
      onClick={() => !disabled && inputRef.current?.focus()}
    >
      {/* Chip list + input */}
      <div className={styles.inner}>
        {chips.map((chip) => (
          <span key={chip} className={styles.chip}>
            <span className={styles.chipLabel}>{chip}</span>
            {!disabled && (
              <button
                type="button"
                className={styles.chipRemove}
                onClick={(e) => { e.stopPropagation(); removeChip(chip); }}
                tabIndex={-1}
                aria-label={`移除标签 ${chip}`}
              >
                ✕
              </button>
            )}
          </span>
        ))}

        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={inputText}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? placeholder : ''}
          disabled={disabled}
          autoComplete="off"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
          }
        />
      </div>

      {/* Suggestions dropdown */}
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          className={styles.list}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()} // keep input focus
        >
          {filtered.map((tag, idx) => (
            <li
              key={tag}
              id={`${listId}-opt-${idx}`}
              role="option"
              aria-selected={false}
              className={`${styles.option} ${idx === activeIndex ? styles.optionActive : ''}`}
              onMouseDown={() => selectSuggestion(tag)}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
