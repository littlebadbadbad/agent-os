/**
 * internal-apps/file/ui/panel/FolderBrowserDialog.tsx — Server filesystem folder picker
 *
 * Ported 1:1 from the devops app's editor, decoupled from a hardcoded
 * API import — the browse function is passed in so this stays reusable
 * and independently testable.
 */

import { useState, useEffect, useCallback } from 'react';
import type { BrowseDirResult } from '../api/workspaceApi';
import styles from './FolderBrowserDialog.module.scss';

interface Props {
  readonly initialPath: string;
  readonly onBrowse: (path: string) => Promise<BrowseDirResult>;
  readonly onConfirm: (path: string) => void;
  readonly onCancel: () => void;
}

export function FolderBrowserDialog({ initialPath, onBrowse, onConfirm, onCancel }: Props) {
  const [browsePath, setBrowsePath] = useState(initialPath);
  const [result, setResult] = useState<BrowseDirResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await onBrowse(path);
      setResult(data);
      setBrowsePath(data.path);
      setPathInput(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onBrowse]);

  useEffect(() => {
    navigate(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigate(pathInput);
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className={styles.overlay} onMouseDown={onCancel}>
      <div className={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>

        <div className={styles.header}>
          <span className={styles.title}>📁 选择文件夹</span>
          <button className={styles.closeBtn} onClick={onCancel} title="关闭">✕</button>
        </div>

        <div className={styles.pathBar}>
          <button
            className={styles.navBtn}
            onClick={() => result?.parent != null && navigate(result.parent)}
            disabled={result?.parent == null || loading}
            title="上级目录"
          >
            ↑
          </button>
          <input
            className={styles.pathInput}
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder="输入路径后按 Enter 导航…"
          />
          <button
            className={styles.navBtn}
            onClick={() => navigate(pathInput)}
            disabled={loading}
            title="导航到此路径"
          >
            →
          </button>
        </div>

        <div className={styles.list}>
          {loading && <div className={styles.hint}>加载中…</div>}
          {!loading && error && <div className={styles.hintError}>{error}</div>}
          {!loading && !error && result?.entries.length === 0 && (
            <div className={styles.hint}>无子目录</div>
          )}
          {!loading && !error && result?.entries.map((entry) => (
            <button
              key={entry.path}
              className={styles.entry}
              onClick={() => navigate(entry.path)}
              title={entry.path}
            >
              <span className={styles.entryIcon}>📁</span>
              <span className={styles.entryName}>{entry.name}</span>
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <span className={styles.selectedPath} title={browsePath}>
            {browsePath || '（根目录）'}
          </span>
          <div className={styles.footerActions}>
            <button className={styles.cancelBtn} onClick={onCancel}>取消</button>
            <button
              className={styles.confirmBtn}
              onClick={() => browsePath && onConfirm(browsePath)}
              disabled={!browsePath}
            >
              选择此文件夹
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
