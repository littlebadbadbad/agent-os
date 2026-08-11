/**
 * ComboSelect.tsx
 * ───────────────
 * A lightweight combobox: text input + filtered dropdown list.
 *
 * Features
 * ════════
 * • Type to filter options (case-insensitive substring match)
 * • Click or press Enter / ArrowDown+Enter to select
 * • Keyboard navigation: ↑ ↓ to move highlight, Enter to confirm, Esc to close
 * • Click outside closes the dropdown
 * • Allows free-text values that are not in the list (pass allowFreeText=true, default)
 * • Controlled: `value` is always the committed value; internal `inputText` tracks typing
 * • `clearable`: shows ✕ button when value is non-empty
 * • Works identically in both form and filter contexts; callers control sizing via className
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useId,
} from 'react';
import styles from './ComboSelect.module.scss';

export interface ComboOption {
  value: string;
  label?: string; // Defaults to `value` when absent
}

export interface ComboSelectProps {
  /** Current committed value */
  value: string;
  /** Called when user commits a new value (select from list, Enter, or blur) */
  onChange: (value: string) => void;
  options: (string | ComboOption)[];
  placeholder?: string;
  disabled?: boolean;
  /** Allow values not in the options list. Default: true */
  allowFreeText?: boolean;
  clearable?: boolean;
  className?: string;
  /** Extra class applied to the internal <input> */
  inputClassName?: string;
  /** aria-label for accessibility */
  ariaLabel?: string;
}

function toOption(raw: string | ComboOption): ComboOption {
  return typeof raw === 'string' ? { value: raw, label: raw } : raw;
}

export function ComboSelect({
  value,
  onChange,
  options,
  placeholder = '请选择或输入…',
  disabled = false,
  allowFreeText = true,
  clearable = false,
  className,
  inputClassName,
  ariaLabel,
}: ComboSelectProps) {
  const normalized = options.map(toOption);

  // What the user is currently typing — starts as the committed value
  const [inputText, setInputText] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Keep inputText in sync when the external value changes (e.g. programmatic set)
  useEffect(() => {
    setInputText(value);
  }, [value]);

  // When the dropdown opens, reset the active highlight
  useEffect(() => {
    if (open) setActiveIndex(-1);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const li = listRef.current?.children[activeIndex] as HTMLLIElement | undefined;
    li?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  // Click-outside to close
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        commitAndClose();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputText, value]);

  const filtered = normalized.filter(
    (o) =>
      !inputText ||
      (o.label ?? o.value).toLowerCase().includes(inputText.toLowerCase()),
  );

  function commitAndClose() {
    if (allowFreeText) {
      if (inputText !== value) onChange(inputText);
    } else {
      // Reject values not in list; restore previous
      const match = normalized.find(
        (o) => o.value === inputText || (o.label ?? '').toLowerCase() === inputText.toLowerCase(),
      );
      if (match) {
        if (match.value !== value) onChange(match.value);
        setInputText(match.label ?? match.value);
      } else {
        setInputText(value); // revert
      }
    }
    setOpen(false);
  }

  const selectOption = useCallback(
    (opt: ComboOption) => {
      setInputText(opt.label ?? opt.value);
      onChange(opt.value);
      setOpen(false);
      inputRef.current?.focus();
    },
    [onChange],
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputText(e.target.value);
    setOpen(true);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setOpen(true);
        setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (open && activeIndex >= 0 && filtered[activeIndex]) {
          selectOption(filtered[activeIndex]);
        } else {
          commitAndClose();
        }
        break;
      case 'Escape':
        setInputText(value); // revert
        setOpen(false);
        break;
      case 'Tab':
        commitAndClose();
        break;
      default:
        break;
    }
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    setInputText('');
    onChange('');
    inputRef.current?.focus();
  }

  const showClear = clearable && value !== '' && !disabled;

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${className ?? ''}`}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-owns={listId}
    >
      <div className={styles.inputRow}>
        <input
          ref={inputRef}
          className={`${styles.input} ${inputClassName ?? ''}`}
          type="text"
          value={inputText}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
          }
        />
        {showClear && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={handleClear}
            tabIndex={-1}
            aria-label="清除"
          >
            ✕
          </button>
        )}
        <span
          className={styles.arrow}
          aria-hidden
          onMouseDown={(e) => {
            e.preventDefault();
            if (!disabled) {
              setOpen((prev) => !prev);
              inputRef.current?.focus();
            }
          }}
        >
          ▾
        </span>
      </div>

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          className={styles.list}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()} // prevent input blur
        >
          {filtered.map((opt, idx) => (
            <li
              key={opt.value}
              id={`${listId}-opt-${idx}`}
              role="option"
              aria-selected={opt.value === value}
              className={`${styles.option}
                ${opt.value === value ? styles.optionSelected : ''}
                ${idx === activeIndex ? styles.optionActive : ''}`}
              onMouseDown={() => selectOption(opt)}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              {opt.label ?? opt.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
