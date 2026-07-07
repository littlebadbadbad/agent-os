/**
 * agent-type/electron-api.d.ts — Global type augmentation for Electron IPC
 *
 * Electron's preload script injects `window.electronAPI` via contextBridge.
 * This declaration makes it visible to TypeScript across the entire monorepo
 * without `(window as any)` casts.
 *
 * @see electron/preload.ts — the runtime implementation
 */

interface ElectronAPI {
  /** Always `true` — allows runtime detection of Electron vs. browser. */
  readonly isElectron: true;
  /** Host platform: `'win32' | 'darwin' | 'linux'` */
  readonly platform: NodeJS.Platform;
  /** Generic request–response: invoke(channel, params?) → Promise<unknown> */
  invoke(channel: string, params?: unknown): Promise<unknown>;
  /** Subscribe to a push event from the main process. Returns an unsubscribe function. */
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
  /** Unsubscribe a specific callback from a channel. */
  off(channel: string, callback: (...args: unknown[]) => void): void;
  /** Remove all listeners for a channel. */
  removeAllListeners(channel: string): void;
}

declare global {
  interface Window {
    /** Injected by the Electron preload script. `undefined` outside Electron. */
    readonly electronAPI?: ElectronAPI;
  }
}

export {};
