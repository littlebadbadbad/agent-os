import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Attachment, DataAttachment, SkillState } from '@agent-sdk';
import { MAX_FILE_BYTES, ACCEPTED_MIME_TYPES, fileToDataAttachment } from './fileAttachment';
import { SendIcon, StopIcon, AttachIcon } from './ChatInputIcons';
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
  /** Currently loaded skills — displayed in the "/" slash-command menu. */
  skills?: readonly SkillState[];
}

export function ChatInput({ onSend, isLoading = false, onCancel, enableAttachments = true, skills = [] }: ChatInputProps): ReactElement {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<DataAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Slash-command state ─────────────────────────────────────────────────
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasSkills = skills.length > 0;
  const filteredSkills = hasSkills
    ? skills.filter((s) =>
        s.name.toLowerCase().includes(slashFilter.toLowerCase()) ||
        s.description.toLowerCase().includes(slashFilter.toLowerCase()),
      )
    : [];

  // Keep selected index in range when filter changes
  useEffect(() => {
    setSlashIndex((prev) => Math.min(prev, Math.max(0, filteredSkills.length - 1)));
  }, [filteredSkills.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (slashOpen && menuRef.current) {
      const items = menuRef.current.querySelectorAll('[data-slash-item]');
      items[slashIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [slashIndex, slashOpen]);

  /** Insert the selected skill name into the input (autocomplete hint only). */
  const selectSkill = useCallback((skill: SkillState) => {
    // Replace input with "/<skillName> " so user can continue typing after it.
    // Skill activation is deferred to submit() so the slash-command menu acts
    // purely as an autocomplete helper with no premature side-effects.
    setValue(`/${skill.name} `);
    setSlashOpen(false);
    setSlashFilter('');
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
      // ── Slash-command navigation ──────────────────────────────────────
      if (slashOpen && filteredSkills.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashIndex((i) => (i + 1) % filteredSkills.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const skill = filteredSkills[slashIndex];
          if (skill) {
            selectSkill(skill);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashOpen(false);
          setSlashFilter('');
          setValue('');
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit, slashOpen, filteredSkills, slashIndex, selectSkill],
  );

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>): void => {
    const newValue = e.target.value;
    setValue(newValue);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;

    // Detect slash-command: starts with "/" and no space before the cursor
    if (hasSkills && newValue.startsWith('/')) {
      setSlashOpen(true);
      setSlashFilter(newValue.slice(1));
      setSlashIndex(0);
    } else {
      if (slashOpen) {
        setSlashOpen(false);
        setSlashFilter('');
      }
    }
  }, [hasSkills, slashOpen]);

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

      {/* Slash-command skill menu */}
      {slashOpen && filteredSkills.length > 0 && (
        <div ref={menuRef} className={styles['slash-menu']} role="listbox" aria-label="Select a skill">
          <div className={styles['slash-menu-header']}>Skills — type to filter</div>
          {filteredSkills.map((skill, i) => (
            <div
              key={skill.name}
              data-slash-item
              role="option"
              aria-selected={i === slashIndex}
              className={`${styles['slash-item']}${i === slashIndex ? ` ${styles['slash-item--active']}` : ''}`}
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => selectSkill(skill)}
            >
              <span className={styles['slash-item-prefix']}>/{skill.name}</span>
              <div className={styles['slash-item-content']}>
                <span className={styles['slash-item-desc']}>{skill.description}</span>
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


