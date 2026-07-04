import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactElement } from 'react';
import type { PendingUserInput } from '@agent-sdk';
import styles from '../AgentWidget.module.scss';

// ── helpers ──────────────────────────────────────────────────────────────────
function clampNumber(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

interface UserInputPromptProps {
  pending: PendingUserInput;
  onRespond: (id: string, value: string | null) => void;
}

/**
 * Inline prompt card rendered above the chat input while a tool is waiting
 * for user input.  Supports all five request shapes from `UserInputRequest`:
 * - `confirm`     → Yes / Cancel buttons
 * - `text`        → free-form input + Submit / Cancel
 * - `select`      → option buttons + Cancel
 * - `multiSelect` → checkboxes + Submit (gated on minSelect) / Cancel
 * - `number`      → numeric input + Submit / Cancel
 */
export function UserInputPrompt({ pending, onRespond }: UserInputPromptProps): ReactElement {
  const { id, request } = pending;
  const [textValue, setTextValue] = useState(
    request.type === 'text' ? (request.defaultValue ?? '') : '',
  );
  const [numValue, setNumValue] = useState(
    request.type === 'number' ? (request.defaultValue !== undefined ? String(request.defaultValue) : '') : '',
  );
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state and auto-focus whenever a new prompt appears.
  useEffect(() => {
    if (request.type === 'text') {
      setTextValue(request.defaultValue ?? '');
    } else if (request.type === 'number') {
      setNumValue(request.defaultValue !== undefined ? String(request.defaultValue) : '');
    } else if (request.type === 'multiSelect') {
      setSelectedOptions([]);
    }
    // Small delay so the card finishes its CSS transition before focus.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleCancel = useCallback(() => onRespond(id, null), [id, onRespond]);
  const handleConfirm = useCallback(() => onRespond(id, 'yes'), [id, onRespond]);
  const handleSelect = useCallback((opt: string) => onRespond(id, opt), [id, onRespond]);
  const handleSubmitText = useCallback(() => {
    onRespond(id, textValue.trim() === '' ? null : textValue.trim());
  }, [id, textValue, onRespond]);
  const handleSubmitNum = useCallback(() => {
    if (numValue === '') { onRespond(id, null); return; }
    const parsed = parseFloat(numValue);
    if (isNaN(parsed)) { onRespond(id, null); return; }
    const clamped = request.type === 'number'
      ? clampNumber(parsed, request.min, request.max)
      : parsed;
    onRespond(id, String(clamped));
  }, [id, numValue, onRespond, request]);
  const handleSubmitMulti = useCallback(() => {
    if (selectedOptions.length === 0) { onRespond(id, null); return; }
    onRespond(id, JSON.stringify(selectedOptions));
  }, [id, selectedOptions, onRespond]);
  const toggleOption = useCallback((opt: string) => {
    setSelectedOptions(prev => {
      if (prev.includes(opt)) return prev.filter(o => o !== opt);
      if (request.type === 'multiSelect' && request.maxSelect !== undefined && prev.length >= request.maxSelect) return prev;
      return [...prev, opt];
    });
  }, [request]);

  return (
    <div className={styles['user-input-prompt']} role="region" aria-label="Tool waiting for input">
      {/* left accent icon */}
      <div className={styles['user-input-prompt-icon']} aria-hidden="true">⏸</div>

      <div className={styles['user-input-prompt-body']}>
        <p className={styles['user-input-prompt-message']}>{request.message}</p>

        {request.type === 'confirm' && (
          <div className={styles['user-input-prompt-actions']}>
            <button
              type="button"
              className={`${styles['user-input-btn']} ${styles['user-input-btn--primary']}`}
              onClick={handleConfirm}
              autoFocus
            >
              Yes
            </button>
            <button
              type="button"
              className={`${styles['user-input-btn']} ${styles['user-input-btn--ghost']}`}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        )}

        {request.type === 'text' && (
          <div className={styles['user-input-text-row']}>
            <input
              ref={inputRef}
              type="text"
              className={styles['user-input-text']}
              value={textValue}
              placeholder={request.placeholder ?? ''}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSubmitText(); }
                if (e.key === 'Escape') handleCancel();
              }}
            />
            <button
              type="button"
              className={`${styles['user-input-btn']} ${styles['user-input-btn--primary']}`}
              onClick={handleSubmitText}
              disabled={textValue.trim() === ''}
            >
              Submit
            </button>
            <button
              type="button"
              className={`${styles['user-input-btn']} ${styles['user-input-btn--ghost']}`}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        )}

        {request.type === 'select' && (
          <div className={styles['user-input-prompt-actions']}>
            {request.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`${styles['user-input-btn']} ${styles['user-input-btn--option']}`}
                onClick={() => handleSelect(opt)}
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              className={`${styles['user-input-btn']} ${styles['user-input-btn--ghost']}`}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        )}

        {request.type === 'multiSelect' && (
          <div className={styles['user-input-multi-select']}>
            <div className={styles['user-input-multi-options']}>
              {request.options.map((opt) => {
                const checked = selectedOptions.includes(opt);
                const maxReached = request.maxSelect !== undefined && selectedOptions.length >= request.maxSelect && !checked;
                return (
                  <label
                    key={opt}
                    className={`${styles['user-input-multi-option']}${maxReached ? ` ${styles['user-input-multi-option--disabled']}` : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={maxReached}
                      onChange={() => toggleOption(opt)}
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
            {request.maxSelect !== undefined && (
              <p className={styles['user-input-multi-hint']}>
                {request.minSelect !== undefined
                  ? `Select ${request.minSelect}–${request.maxSelect} options`
                  : `Select up to ${request.maxSelect} options`}
              </p>
            )}
            <div className={styles['user-input-prompt-actions']}>
              <button
                type="button"
                className={`${styles['user-input-btn']} ${styles['user-input-btn--primary']}`}
                onClick={handleSubmitMulti}
                disabled={request.minSelect !== undefined && selectedOptions.length < request.minSelect}
              >
                Submit
              </button>
              <button
                type="button"
                className={`${styles['user-input-btn']} ${styles['user-input-btn--ghost']}`}
                onClick={handleCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {request.type === 'number' && (
          <div className={styles['user-input-text-row']}>
            <input
              ref={inputRef}
              type="number"
              className={styles['user-input-text']}
              value={numValue}
              placeholder={request.placeholder ?? ''}
              min={request.min}
              max={request.max}
              step={request.step}
              onChange={(e) => setNumValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSubmitNum(); }
                if (e.key === 'Escape') handleCancel();
              }}
            />
            <button
              type="button"
              className={`${styles['user-input-btn']} ${styles['user-input-btn--primary']}`}
              onClick={handleSubmitNum}
              disabled={numValue === ''}
            >
              Submit
            </button>
            <button
              type="button"
              className={`${styles['user-input-btn']} ${styles['user-input-btn--ghost']}`}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
