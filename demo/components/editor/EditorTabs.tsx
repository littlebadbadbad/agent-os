import React from 'react';
import type { OpenFile } from '../../hooks/useEditorState';
import styles from './EditorTabs.module.scss';

interface Props {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

/** Returns just the file name from a workspace-relative path. */
function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function EditorTabs({ openFiles, activeFilePath, onActivate, onClose }: Props) {
  if (openFiles.length === 0) return null;

  return (
    <div className={styles.tabBar} role="tablist">
      {openFiles.map((file) => {
        const isDirty = file.content !== file.savedContent;
        const isActive = file.path === activeFilePath;
        return (
          <div
            key={file.path}
            role="tab"
            aria-selected={isActive}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            title={file.path}
            onClick={() => onActivate(file.path)}
          >
            {isDirty && <span className={styles.dirtyDot} title="未保存" />}
            <span className={styles.label}>{fileName(file.path)}</span>
            <button
              className={styles.closeBtn}
              onClick={(e) => {
                e.stopPropagation();
                onClose(file.path);
              }}
              title="关闭"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
