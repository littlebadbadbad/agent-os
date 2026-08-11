import { useState, useCallback, type ReactElement } from 'react';
import type { BrowserLaunchConfig } from '../agent/index';
import { safeLaunchConfig } from '../agent/safeConfig';
import styles from './BrowserPanel.module.scss';

// ── BrowserConfigPanel ────────────────────────────────────────────────────────
// JSON-editor panel rendered below the addr-bar when the user clicks ⚙.
// Supports both "new session" mode (controlled externally) and
// "live session" mode (calls onApply, which triggers a browser restart).

export interface BrowserConfigPanelProps {
  /** Current configuration to display as initial state. */
  config: BrowserLaunchConfig;
  /** Called when the user clicks Apply. Receives the full merged config. */
  onApply(config: BrowserLaunchConfig): void;
  /** Called when the user clicks the ✕ close button. */
  onClose(): void;
  /** Disable Apply while a restart is in progress. */
  applying?: boolean;
}

// ── Full example config (all supported fields with default/example values) ────

const FULL_EXAMPLE_CONFIG: Required<Omit<BrowserLaunchConfig, 'geolocation' | 'httpCredentials' | 'storageState' | 'downloadsPath' | 'channel'>> & Pick<BrowserLaunchConfig, 'geolocation' | 'httpCredentials' | 'storageState' | 'downloadsPath' | 'channel'> = {
  // ── Appearance ─────────────────────────────────────────────────────────────
  headless:          true,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36',
  viewport:          { width: 1280, height: 720 },
  colorScheme:       'light',
  deviceScaleFactor: 1,
  // ── Locale & time ──────────────────────────────────────────────────────────
  locale:            'zh-CN,zh;q=0.9,en;q=0.8',
  timezoneId:        'Asia/Shanghai',
  // ── Device emulation ───────────────────────────────────────────────────────
  hasTouch:          false,
  isMobile:          false,
  // ── Security ───────────────────────────────────────────────────────────────
  ignoreHTTPSErrors: true,
  bypassCSP:         false,
  javaScriptEnabled: true,
  // ── Downloads ──────────────────────────────────────────────────────────────
  acceptDownloads:   true,
  downloadsPath:     'C:/Users/you/Downloads/browser',
  // ── Network ────────────────────────────────────────────────────────────────
  offline:           false,
  httpCredentials:   { username: 'admin', password: 'secret' },
  // ── Session state ──────────────────────────────────────────────────────────
  storageState:      '/path/to/playwright-state.json',
  // ── Launch options ─────────────────────────────────────────────────────────
  slowMo:            0,
  devtools:          false,
  channel:           'chrome',
  extraArgs:         ['--disable-gpu', '--disable-dev-shm-usage'],
  // ── Permissions & geolocation ──────────────────────────────────────────────
  permissions:       ['geolocation', 'notifications', 'camera', 'microphone'],
  geolocation:       { latitude: 39.9042, longitude: 116.4074, accuracy: 100 },
};

const FULL_EXAMPLE_JSON = JSON.stringify(FULL_EXAMPLE_CONFIG, null, 2);

// ── Main component ─────────────────────────────────────────────────────────────

export function BrowserConfigPanel({
  config,
  onApply,
  onClose,
  applying = false,
}: BrowserConfigPanelProps): ReactElement {
  const [json, setJson]             = useState(() => JSON.stringify(config, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [showExample, setShowExample] = useState(false);

  const handleApply = useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      return;
    }
    const config = safeLaunchConfig(parsed);
    if (!config) {
      setParseError('Config must be a JSON object with valid browser config fields');
      return;
    }
    onApply(config);
  }, [json, onApply]);

  const handleLoadExample = useCallback(() => {
    setJson(FULL_EXAMPLE_JSON);
    setParseError(null);
    setShowExample(false);
  }, []);

  return (
    <div className={styles['config-panel']}>

      {/* Header */}
      <div className={styles['config-panel-header']}>
        <span className={styles['config-panel-title']}>Browser Configuration</span>
        <div className={styles['config-panel-header-actions']}>
          <button
            type="button"
            className={styles['cfg-example-btn']}
            onClick={() => setShowExample(v => !v)}
            title="Show all supported fields with example values"
          >
            {showExample ? 'Hide example ▴' : 'Full example ▾'}
          </button>
          <button
            type="button"
            className={styles['config-panel-close']}
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Collapsible full-example pane */}
      {showExample && (
        <div className={styles['cfg-example-pane']}>
          <div className={styles['cfg-example-bar']}>
            <span className={styles['cfg-example-label']}>All supported fields (defaults / examples)</span>
            <button
              type="button"
              className={styles['cfg-example-load-btn']}
              onClick={handleLoadExample}
              title="Copy the full example into the editor"
            >
              Load into editor
            </button>
          </div>
          <pre className={styles['cfg-example-pre']}>{FULL_EXAMPLE_JSON}</pre>
        </div>
      )}

      {/* JSON editor body */}
      <div className={styles['config-panel-body']}>
        <textarea
          className={styles['cfg-json-textarea']}
          value={json}
          onChange={e => { setJson(e.target.value); setParseError(null); }}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="{}"
        />
        {parseError && (
          <div className={styles['cfg-json-error']}>
            ⚠ {parseError}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={styles['config-panel-footer']}>
        <button
          type="button"
          className={styles['config-panel-apply']}
          onClick={handleApply}
          disabled={applying}
        >
          {applying ? 'Restarting…' : 'Apply & restart'}
        </button>
      </div>

    </div>
  );
}
