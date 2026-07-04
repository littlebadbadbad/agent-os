import { useState, useCallback, type ReactElement } from 'react';
import type { StreamConfig } from '../agent/index';
import styles from './BrowserPanel.module.scss';

// ── Presets ────────────────────────────────────────────────────────────────────

interface ViewportPreset {
  label: string;
  width: number;
  height: number;
}

const VIEWPORT_PRESETS: ViewportPreset[] = [
  { label: '1280×720',   width: 1280, height: 720 },
  { label: '1366×768',   width: 1366, height: 768 },
  { label: '1920×1080',  width: 1920, height: 1080 },
  { label: '1440×900',   width: 1440, height: 900 },
  { label: '375×667',    width: 375,  height: 667 },   // iPhone SE
  { label: '414×896',    width: 414,  height: 896 },   // iPhone 11
  { label: '390×844',    width: 390,  height: 844 },   // iPhone 14
  { label: '430×932',    width: 430,  height: 932 },   // iPhone 15 Pro Max
  { label: '768×1024',   width: 768,  height: 1024 },  // iPad
  { label: '1024×1366',  width: 1024, height: 1366 },  // iPad Pro
];

// ── Props ──────────────────────────────────────────────────────────────────────

export interface BrowserVideoSettingsProps {
  /** Current stream configuration. */
  streamConfig: StreamConfig;
  /** Called when FPS or quality changes. */
  onStreamConfigChange(config: Partial<StreamConfig>): void;
  /** Current viewport dimensions (from the live browser session). */
  viewport: { width: number; height: number };
  /** Called when the user applies a new viewport size. */
  onViewportChange(width: number, height: number): void;
  /** Called to close the panel. */
  onClose(): void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function BrowserVideoSettings({
  streamConfig,
  onStreamConfigChange,
  viewport,
  onViewportChange,
  onClose,
}: BrowserVideoSettingsProps): ReactElement {
  const [vpWidth, setVpWidth] = useState(String(viewport.width));
  const [vpHeight, setVpHeight] = useState(String(viewport.height));
  const [vpError, setVpError] = useState<string | null>(null);

  // Sync inputs when viewport changes externally (e.g. drag resize).
  if (String(viewport.width) !== vpWidth && !vpError) {
    // Only sync if user hasn't typed a conflicting value.
  }

  const handleFpsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val)) onStreamConfigChange({ fps: val });
  }, [onStreamConfigChange]);

  const handleQualityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val)) onStreamConfigChange({ quality: val });
  }, [onStreamConfigChange]);

  const handleApplyViewport = useCallback(() => {
    const w = parseInt(vpWidth, 10);
    const h = parseInt(vpHeight, 10);
    if (isNaN(w) || w < 100 || w > 7680) {
      setVpError('Width must be 100–7680');
      return;
    }
    if (isNaN(h) || h < 50 || h > 4320) {
      setVpError('Height must be 50–4320');
      return;
    }
    setVpError(null);
    onViewportChange(w, h);
  }, [vpWidth, vpHeight, onViewportChange]);

  const handlePreset = useCallback((preset: ViewportPreset) => {
    setVpWidth(String(preset.width));
    setVpHeight(String(preset.height));
    setVpError(null);
    onViewportChange(preset.width, preset.height);
  }, [onViewportChange]);

  return (
    <div className={styles['video-settings']}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={styles['video-settings-header']}>
        <span className={styles['video-settings-title']}>🖥 Video Settings</span>
        <button
          type="button"
          className={styles['video-settings-close']}
          onClick={onClose}
          title="Close video settings"
        >
          ×
        </button>
      </div>

      <div className={styles['video-settings-body']}>

        {/* ── FPS slider ────────────────────────────────────────────────── */}
        <label className={styles['vs-row']}>
          <span className={styles['vs-label']}>FPS</span>
          <input
            type="range"
            className={styles['vs-slider']}
            min={1}
            max={60}
            step={1}
            value={streamConfig.fps}
            onChange={handleFpsChange}
          />
          <input
            type="number"
            className={styles['vs-number']}
            min={1}
            max={60}
            value={streamConfig.fps}
            onChange={handleFpsChange}
          />
          <span className={styles['vs-unit']}>fps</span>
        </label>

        {/* ── Quality slider ────────────────────────────────────────────── */}
        <label className={styles['vs-row']}>
          <span className={styles['vs-label']}>Quality</span>
          <input
            type="range"
            className={styles['vs-slider']}
            min={10}
            max={100}
            step={5}
            value={streamConfig.quality}
            onChange={handleQualityChange}
          />
          <input
            type="number"
            className={styles['vs-number']}
            min={10}
            max={100}
            step={5}
            value={streamConfig.quality}
            onChange={handleQualityChange}
          />
          <span className={styles['vs-unit']}>%</span>
        </label>

        {/* ── Viewport ──────────────────────────────────────────────────── */}
        <div className={styles['vs-row']}>
          <span className={styles['vs-label']}>Viewport</span>
          <input
            type="number"
            className={styles['vs-number']}
            min={100}
            max={7680}
            value={vpWidth}
            onChange={e => { setVpWidth(e.target.value); setVpError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') handleApplyViewport(); }}
            title="Width (px)"
          />
          <span className={styles['vs-sep']}>×</span>
          <input
            type="number"
            className={styles['vs-number']}
            min={50}
            max={4320}
            value={vpHeight}
            onChange={e => { setVpHeight(e.target.value); setVpError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') handleApplyViewport(); }}
            title="Height (px)"
          />
          <button
            type="button"
            className={styles['vs-apply-btn']}
            onClick={handleApplyViewport}
            title="Apply viewport size"
          >
            Apply
          </button>
        </div>
        {vpError && <div className={styles['vs-error']}>⚠ {vpError}</div>}

        {/* ── Viewport preset buttons ───────────────────────────────────── */}
        <div className={styles['vs-presets']}>
          {VIEWPORT_PRESETS.map(p => (
            <button
              key={p.label}
              type="button"
              className={styles['vs-preset-btn']}
              onClick={() => handlePreset(p)}
              title={`${p.label} — ${p.width}×${p.height}`}
            >
              {p.label}
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}
