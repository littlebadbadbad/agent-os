/**
 * electron/preload.ts — Electron preload script
 *
 * Compiled to dist-electron/preload.cjs by scripts/compile-electron.mjs.
 * Runs in the renderer process with Node.js integration disabled; exposes a
 * full IPC bridge via contextBridge so the renderer can call backend
 * operations without HTTP.
 *
 * Streaming channels use `on(channel, callback)` / `off(channel, callback)`
 * for push-based messages from main → renderer.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * All IPC channel categories:
 *
 * chat:       async, stream:start, stream:stop
 *             Push events: chat:stream:chunk, chat:stream:done, chat:stream:error
 * browser:    list, create, remove, navigate, evaluate, readOutput, snapshot,
 *             screenshotData, wait, setLaunchConfig, switchTab,
 *             networkRequests, clearNetworkRequests
 * sessions:   load, save
 * health:     check
 * publicKey:  get
 * app:     <appId>:<method> — handled dynamically via app-router.js
 *             (git, file, and dynamic-tool IPC are registered by their
 *             respective app backend's activate() function)
 */

interface ElectronAPI {
  isElectron: true;
  platform: NodeJS.Platform;
  invoke(channel: string, params?: unknown): Promise<unknown>;
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
  off(channel: string, callback: (...args: unknown[]) => void): void;
  removeAllListeners(channel: string): void;
}

const electronAPI: ElectronAPI = {
  isElectron: true,
  platform: process.platform,

  /** Generic request–response: invoke(channel, params) → Promise<any> */
  invoke: (channel: string, params?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, params),

  /** Subscribe to a push event from the main process. */
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, handler);
    // Return an unsubscribe function
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  /** Remove a specific listener */
  off: (channel: string, callback: (...args: unknown[]) => void): void => {
    ipcRenderer.removeListener(channel, callback);
  },

  /** Remove all listeners for a channel */
  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
