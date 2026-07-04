import { useEffect, useState, useRef } from 'react';
import { fetchBuildDefinitionDetail } from '../../api';
import type { BuildDefinitionDetail } from '../../api';
import { uiBridge } from '../../tools/uiBridge';
import styles from './Builds.module.scss';

interface QueueBuildDialogProps {
  collectionUrl: string;
  project: string;
  pat: string;
  definitionId: number;
  definitionName: string;
  submitting: boolean;
  onConfirm: (branch: string, params: Record<string, string>) => void;
  onCancel: () => void;
}

export function QueueBuildDialog({
  collectionUrl,
  project,
  pat,
  definitionId,
  definitionName,
  submitting,
  onConfirm,
  onCancel,
}: QueueBuildDialogProps) {
  const [detail, setDetail] = useState<BuildDefinitionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  // ── Bridge registration ───────────────────────────────────────────────────
  const stateRef = useRef({ detail, loading, branch, values });
  stateRef.current = { detail, loading, branch, values };

  useEffect(() => {
    uiBridge.register('builds.queue.getState', () => stateRef.current);
    uiBridge.register('builds.queue.setBranch', setBranch);
    uiBridge.register('builds.queue.setParam', (key: string, value: string) =>
      setValues((prev) => ({ ...prev, [key]: value })),
    );
    uiBridge.register('builds.queue.submit', () => {
      const form = document.querySelector<HTMLFormElement>('[data-queue-form]');
      if (form) form.requestSubmit();
    });
    return () => {
      uiBridge.unregister('builds.queue.getState');
      uiBridge.unregister('builds.queue.setBranch');
      uiBridge.unregister('builds.queue.setParam');
      uiBridge.unregister('builds.queue.submit');
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchBuildDefinitionDetail(collectionUrl, project, pat, definitionId)
      .then((d) => {
        setDetail(d);
        setBranch(d.repository?.defaultBranch ?? 'refs/heads/main');
        const init: Record<string, string> = {};
        for (const [k, v] of Object.entries(d.variables ?? {})) {
          if (v.allowOverride) {
            init[k] = v.isSecret ? '' : (v.value ?? '');
          }
        }
        setValues(init);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [collectionUrl, project, pat, definitionId]);

  const overridableVars = detail
    ? Object.entries(detail.variables ?? {}).filter(([, v]) => v.allowOverride)
    : [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(branch, values);
  }

  return (
    <>
      <div className={styles.dialogBackdrop} onClick={onCancel} />
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="触发构建">
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>触发构建</span>
          <button className={styles.dialogClose} onClick={onCancel} disabled={submitting}>✕</button>
        </div>

        <div className={styles.dialogSubtitle}>{definitionName}</div>

        {loading ? (
          <div className={styles.dialogLoading}>加载参数中…</div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.dialogForm} data-queue-form>
            <div className={styles.dialogField}>
              <label className={styles.dialogLabel}>分支 / Branch</label>
              <input
                className={styles.dialogInput}
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="refs/heads/main"
                autoComplete="off"
              />
            </div>

            {overridableVars.length > 0 && (
              <div className={styles.dialogVars}>
                <div className={styles.dialogVarsHeading}>构建参数（可覆盖）</div>
                {overridableVars.map(([key, meta]) => (
                  <div key={key} className={styles.dialogField}>
                    <label className={styles.dialogLabel}>{key}</label>
                    <input
                      className={styles.dialogInput}
                      type={meta.isSecret ? 'password' : 'text'}
                      value={values[key] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={meta.isSecret ? '（安全值，留空保持默认）' : (meta.value ?? '')}
                      autoComplete={meta.isSecret ? 'new-password' : 'off'}
                    />
                  </div>
                ))}
              </div>
            )}

            {overridableVars.length === 0 && !loading && (
              <p className={styles.dialogNoVars}>该 Pipeline 没有可在触发时覆盖的参数。</p>
            )}

            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogCancelBtn}
                onClick={onCancel}
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="submit"
                className={styles.queueBtn}
                disabled={submitting || loading}
              >
                {submitting ? '触发中…' : '▶ 确认触发'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
