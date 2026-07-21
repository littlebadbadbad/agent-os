import React, { useState, useEffect, useCallback } from 'react';
import { browseDir } from '../../api/files';
import type { BrowseDirResult } from '../../api/files';
import styles from './FolderBrowserDialog.module.scss';

interface Props {
  initialPath: string;
  onConfirm: (path: string) => void;
  onCancel: () => void;
}

export function FolderBrowserDialog({ initialPath, onConfirm, onCancel }: Props) {
  const [browsePath, setBrowsePath] = useState(initialPath);
  const [result, setResult] = useState<BrowseDirResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await browseDir(path);
      setResult(data);
      setBrowsePath(data.path);
      setPathInput(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    navigate(initialPath);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigate(pathInput);
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className={styles.overlay} onMouseDown={onCancel}>
      <div className={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className={styles.header}>
          <span className={styles.title}>📁 选择文件夹</span>
          <button className={styles.closeBtn} onClick={onCancel} title="关闭">✕</button>
        </div>

        {/* ── Path bar ── */}
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

        {/* ── Directory list ── */}
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

        {/* ── Footer ── */}
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
