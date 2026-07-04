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
    (window as any).electronAPI?.invoke
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
