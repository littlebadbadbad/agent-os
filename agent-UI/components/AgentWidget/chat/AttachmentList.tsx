import type { ReactElement } from 'react';
import type { Attachment, DataAttachment } from '@agent-type';
import styles from '../AgentWidget.module.scss';

export function AttachmentList({ attachments }: { attachments: readonly Attachment[] }): ReactElement | null {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className={styles['msg-attachments']}>
      {attachments.map((att, i) => {
        // ── URL-sourced attachment (always image by type constraint) ──────
        if (att.source === 'url') {
          return (
            <img
              key={i}
              src={att.url}
              alt={att.name ?? 'attachment'}
              className={styles['msg-attach-image']}
            />
          );
        }

        const da = att as DataAttachment;
        const src = `data:${da.mimeType};base64,${da.data}`;

        // ── Image ─────────────────────────────────────────────────────────
        if (da.kind === 'image') {
          return (
            <img
              key={i}
              src={src}
              alt={da.name ?? 'image'}
              className={styles['msg-attach-image']}
            />
          );
        }

        // ── Video ─────────────────────────────────────────────────────────
        if (da.kind === 'video') {
          return (
            <video key={i} controls className={styles['msg-attach-video']}>
              <source src={src} type={da.mimeType} />
              {da.name ?? 'video'}
            </video>
          );
        }

        // ── Audio ─────────────────────────────────────────────────────────
        if (da.kind === 'audio') {
          return (
            <audio key={i} controls className={styles['msg-attach-audio']}>
              <source src={src} type={da.mimeType} />
              {da.name ?? 'audio'}
            </audio>
          );
        }

        // ── Document / other ─────────────────────────────────────────────
        return (
          <a
            key={i}
            href={src}
            download={da.name ?? 'attachment'}
            className={styles['msg-attach-doc']}
            title={`Download ${da.name ?? da.mimeType}`}
          >
            <span className={styles['msg-attach-doc-icon']} aria-hidden="true">📄</span>
            <span className={styles['msg-attach-doc-name']}>{da.name ?? da.mimeType}</span>
            {da.size !== undefined && (
              <span className={styles['msg-attach-doc-size']}>
                {da.size < 1024
                  ? `${da.size} B`
                  : da.size < 1024 * 1024
                  ? `${(da.size / 1024).toFixed(1)} KB`
                  : `${(da.size / (1024 * 1024)).toFixed(1)} MB`}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
