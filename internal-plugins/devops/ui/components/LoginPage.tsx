import React, { useState, useEffect, useRef } from 'react';
import { fetchCurrentUser } from '../api/user';
import { useDevOps } from '../store/devopsStore';
import { Spinner } from './shared/Spinner';
import { uiBridge } from '../tools/uiBridge';
import styles from './login/LoginPage.module.scss';

const DEFAULT_SERVER = 'https://navi.united-imaging.com/';

export function LoginPage() {
  const { dispatch } = useDevOps();
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [pat, setPat] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Bridge registration ───────────────────────────────────────────────────
  const stateRef = useRef({ serverUrl, pat, loading, error });
  stateRef.current = { serverUrl, pat, loading, error };

  useEffect(() => {
    uiBridge.register('login.setServerUrl', setServerUrl);
    uiBridge.register('login.setPat', setPat);
    uiBridge.register('login.getState', () => stateRef.current);
    return () => {
      uiBridge.unregister('login.setServerUrl');
      uiBridge.unregister('login.setPat');
      uiBridge.unregister('login.getState');
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!serverUrl.trim() || !pat.trim()) return;

    setLoading(true);
    setError(null);

    const url = serverUrl.trim().replace(/\/$/, '');

    try {
      const user = await fetchCurrentUser(url, pat.trim());
      dispatch({
        type: 'LOGIN',
        payload: { config: { serverUrl: url, pat: pat.trim() }, user },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`认证失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }

  // Register submit handler after it's defined
  useEffect(() => {
    uiBridge.register('login.submit', () => {
      const form = document.querySelector<HTMLFormElement>('[data-login-form]');
      if (form) form.requestSubmit();
    });
    return () => uiBridge.unregister('login.submit');
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="8" fill="#0078d4" />
            <path d="M8 30L16 10L24 22L30 16L32 30H8Z" fill="white" opacity="0.9" />
          </svg>
        </div>
        <h1 className={styles.title}>Azure DevOps</h1>
        <p className={styles.subtitle}>连接到您的 Azure DevOps 服务器</p>

        <form onSubmit={handleSubmit} className={styles.form} data-login-form>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="serverUrl">
              服务器地址
            </label>
            <input
              id="serverUrl"
              type="url"
              className={styles.input}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://navi.united-imaging.com/"
              required
              disabled={loading}
              autoComplete="url"
            />
            <p className={styles.hint}>默认：https://navi.united-imaging.com/</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="pat">
              Personal Access Token (PAT)
            </label>
            <input
              id="pat"
              type="password"
              className={styles.input}
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="输入您的 PAT..."
              required
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className={styles.error} role="alert">
              <span className={styles.errorIcon}>⚠</span>
              {error}
            </div>
          )}

          <button type="submit" className={styles.submitBtn} disabled={loading || !pat.trim()}>
            {loading ? <Spinner size="sm" /> : '连接'}
          </button>
        </form>
      </div>
    </div>
  );
}
