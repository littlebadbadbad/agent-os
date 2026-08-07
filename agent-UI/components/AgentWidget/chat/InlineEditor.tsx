import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react';
import type { DataAttachment } from '@agent-type';
import { MAX_FILE_BYTES, ACCEPTED_MIME_TYPES, fileToDataAttachment } from './fileAttachment';
import { AttachIcon } from './ChatInputIcons';
import styles from '../AgentWidget.module.scss';

interface InlineEditorProps {
  readonly initialText: string;
  readonly initialAttachments: readonly DataAttachment[];
  readonly onSave: (text: string, attachments?: readonly DataAttachment[]) => void;
  readonly onCancel: () => void;
}

/** Inline "edit & resend" form shown in place of a user prompt while editing. */
export function InlineEditor({
  initialText,
  initialAttachments,
  onSave,
  onCancel,
}: InlineEditorProps): ReactElement {
  const [text, setText] = useState(initialText);
  const [attachments, setAttachments] = useState<DataAttachment[]>(() => [...initialAttachments]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setAttachError(null);
    const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const saveButton = e.currentTarget
          .closest('[data-edit-form]')
          ?.querySelector('[data-edit-save]');
        if (saveButton instanceof HTMLButtonElement) saveButton.click();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onCancel],
  );

  const handleSave = useCallback((): void => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSave(trimmed, attachments.length > 0 ? attachments : undefined);
  }, [text, attachments, onSave]);

  return (
    <div className={styles['edit-form']} data-edit-form>
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
      {attachError && (
        <div className={styles['attach-error']} role="alert">{attachError}</div>
      )}
      <textarea
        className={styles['edit-textarea']}
        value={text}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        rows={Math.max(2, text.split('\n').length)}
      />
      <div className={styles['edit-actions']}>
        <button
          type="button"
          className={styles['edit-cancel-btn']}
          onClick={onCancel}
          data-edit-cancel
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles['attach-btn']}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
          title="Attach image or document"
        >
          <AttachIcon />
        </button>
        <button
          type="button"
          className={styles['edit-save-btn']}
          onClick={handleSave}
          data-edit-save
        >
          Save & Resend
        </button>
      </div>
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
    </div>
  );
}
