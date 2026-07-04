/**
 * src/tools/browser/streamConfig.ts — Live stream configuration
 *
 * Stream-time-only parameters that affect the live preview **without**
 * requiring a browser restart.  Distinct from `BrowserLaunchConfig` which
 * controls the initial browser/context launch.
 *
 * `fps`   — frames per second sent to the live-view client (1–60).
 * `quality` — JPEG compression strength for each screenshot frame (10–100).
 */

// ── StreamConfig ──────────────────────────────────────────────────────────────

export interface StreamConfig {
  /**
   * Target frames per second (1–60).
   * @default 24
   */
  fps: number;

  /**
   * JPEG quality for live preview frames (10–100).
   * Higher = larger payloads, better image fidelity.
   * @default 80
   */
  quality: number;
}

// ── Defaults ───────────────────────────────────────────────────────────────────

export const DEFAULT_STREAM_CONFIG: StreamConfig = Object.freeze({
  fps:     24,
  quality: 80,
});

// ── Clamp helpers ──────────────────────────────────────────────────────────────

const CLAMP = {
  fps(val: number): number {
    return Math.max(1, Math.min(60, Math.round(val)));
  },
  quality(val: number): number {
    return Math.max(10, Math.min(100, Math.round(val)));
  },
} as const;

/**
 * Merge a partial `StreamConfig` with the defaults, clamping every field
 * to its valid range.  Returns a new object (never mutates the input).
 */
export function mergeStreamConfig(
  partial?: Partial<StreamConfig>,
): StreamConfig {
  return {
    fps:     partial?.fps     !== undefined ? CLAMP.fps(partial.fps)     : DEFAULT_STREAM_CONFIG.fps,
    quality: partial?.quality !== undefined ? CLAMP.quality(partial.quality) : DEFAULT_STREAM_CONFIG.quality,
  };
}

/**
 * Return `true` when every field in `config` is within its valid range.
 */
export function isValidStreamConfig(config: unknown): config is StreamConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  return (
    typeof c.fps     === 'number' && c.fps     >= 1 && c.fps     <= 60 &&
    typeof c.quality === 'number' && c.quality >= 10 && c.quality <= 100
  );
}
