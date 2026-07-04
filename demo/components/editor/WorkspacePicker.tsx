import React, { useState } from 'react';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import styles from './WorkspacePicker.module.scss';

interface Props {
  currentPath: string;
  loading: boolean;
  onOpen: (absPath: string) => void;
}

export function WorkspacePicker({ currentPath, loading, onOpen }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleConfirm(path: string) {
    setDialogOpen(false);
    onOpen(path);
  }

  return (
    <div className={styles.picker}>
      <button
        className={styles.btn}
        onClick={() => setDialogOpen(true)}
        disabled={loading}
      >
        <span className={styles.btnIcon}>📁</span>
        {loading ? '打开中…' : '打开文件夹…'}
      </button>

      {currentPath && (
        <div className={styles.current} title={currentPath}>
          <span className={styles.currentIcon}>📁</span>
          <span className={styles.currentPath}>{currentPath}</span>
        </div>
      )}

      {dialogOpen && (
        <FolderBrowserDialog
          initialPath={currentPath}
          onConfirm={handleConfirm}
          onCancel={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
