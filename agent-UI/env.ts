/**
 * agent-UI/env.ts — Runtime environment detection
 *
 * Detects whether the app is running inside Electron (IPC available) or
 * in standalone HTTP mode (HTTP only).
 */

export type RuntimeEnvironment = 'electron-ipc' | 'standalone';

/**
 * Detect whether `window.electronAPI.invoke` is available.
 * This is exposed by the preload script only when running inside Electron.
 */
export function detectEnvironment(): RuntimeEnvironment {
  if (
    typeof window !== 'undefined' &&
    window.electronAPI?.invoke
  ) {
    return 'electron-ipc';
  }
  return 'standalone';
}

/**
 * True when running inside Electron with IPC bridge available.
 */
export const IS_ELECTRON_IPC = detectEnvironment() === 'electron-ipc';

/**
 * True when running as a standalone web app (HTTP backend).
 */
export const IS_STANDALONE = !IS_ELECTRON_IPC;

/**
 * True when debug tooling should be enabled.
 *
 * Enabled in Vite dev builds (`import.meta.env.DEV`) or when the URL carries
 * a `?debug` / `?netdebug` query parameter, which lets debug overlays be
 * surfaced in a production bundle for on-site diagnosis.
 *
 * Evaluated once at module load — the value is constant for the app lifetime.
 */
export const IS_DEBUG: boolean = (() => {
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    return q.has('debug') || q.has('netdebug');
  } catch {
    return false;
  }
})();
