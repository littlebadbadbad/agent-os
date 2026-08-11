/**
 * agent-UI/app/core/app-manager.ts — Super built-in "app-manager" app API
 *
 * Typed wrappers around app management backend API methods.
 * All calls go through AppApiClient (dual HTTP/IPC transport).
 *
 * This replaces the old appManagerApi (agent-UI/appManager/appManagerApi.ts)
 * which used apiTransport directly.
 */

import { createAppApiClient } from '../apiClient';
import type { AppInfo } from '../appTypes';

const client = createAppApiClient('app-manager');

interface AppActionResponse {
  readonly ok?: boolean;
  readonly error?: string;
}

interface AppInstallResponse {
  readonly ok?: boolean;
  readonly error?: string;
  readonly appId?: string;
}

// ── File picker helpers ──────────────────────────────────────────────────────

interface DialogResult {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
}

/**
 * Runtime type guard: checks whether an unknown value matches DialogResult.
 * Uses Object.assign to get a clean Record — no `as` cast needed.
 */
function isDialogResult(value: unknown): value is DialogResult {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = Object.assign(Object.create(null), value);
  return typeof record.canceled === 'boolean'
    && Array.isArray(record.filePaths);
}

/**
 * Access window.electronAPI which is globally declared in electron-api.d.ts.
 * No `as` cast needed — the global type augmentation handles it.
 * Return type is inferred from Window.electronAPI (ElectronAPI | undefined).
 */
function getElectronApi() {
  return window.electronAPI;
}

async function pickFolder(): Promise<string | null> {
  const ea = getElectronApi();
  if (typeof ea?.invoke === 'function') {
    try {
      const result = await ea.invoke('dialog:openDirectory');
      if (isDialogResult(result) && !result.canceled && result.filePaths[0]) {
        return result.filePaths[0];
      }
    } catch {
      // fall through
    }
  }
  return prompt('Enter the absolute path to the app folder:');
}

/**
 * Install a app from a known folder path — shared by the UI's
 * "install from folder" picker flow and the agent-facing `install_app`
 * tool (which already has the path, no picker needed).
 */
async function installAppFromPath(folderPath: string): Promise<AppInstallResponse> {
  try {
    const raw = await client.call<AppInstallResponse>('installFolder', { path: folderPath });
    return { ok: raw.ok === true, error: raw.error, appId: raw.appId };
  } catch (err) {
    return { ok: false, error: `Install failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export const appManagerApi = {
  async list(): Promise<readonly AppInfo[]> {
    try {
      const res = await client.call<{ apps: readonly AppInfo[] }>('list');
      return Array.isArray(res.apps) ? res.apps : [];
    } catch {
      return [];
    }
  },

  async getConfig(appId: string): Promise<Record<string, unknown>> {
    return client.call<Record<string, unknown>>('getConfig', { appId });
  },

  async saveConfig(appId: string, config: Record<string, unknown>): Promise<void> {
    await client.call('saveConfig', { appId, config });
  },

  async enable(appId: string): Promise<AppActionResponse> {
    try {
      const raw = await client.call<AppActionResponse>('enable', { appId });
      return { ok: raw.ok === true, error: raw.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async disable(appId: string): Promise<AppActionResponse> {
    try {
      const raw = await client.call<AppActionResponse>('disable', { appId });
      return { ok: raw.ok === true, error: raw.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async installFromZip(): Promise<AppInstallResponse> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.style.display = 'none';

    const file: File | null = await new Promise((resolve) => {
      input.addEventListener('change', () => {
        resolve(input.files?.[0] ?? null);
        input.remove();
      });
      input.addEventListener('cancel', () => {
        input.remove();
        resolve(null);
      });
      document.body.appendChild(input);
      input.click();
    });

    if (!file) return { ok: false, error: 'No file selected' };

    try {
      // Convert file to base64 string for reliable JSON transport.
      // Sending raw ArrayBuffer as JSON-serialized number[] is:
      //   1. Enormously wasteful (3-8x size expansion)
      //   2. Broken — AdmZip on the backend cannot parse plain number[]
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const zipBase64 = btoa(binary);

      const raw = await client.call<AppInstallResponse>('installZip', { zipBase64 });
      return { ok: raw.ok === true, error: raw.error, appId: raw.appId };
    } catch (err) {
      return { ok: false, error: `Install failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async installFromFolder(): Promise<AppInstallResponse> {
    const folderPath = await pickFolder();
    if (!folderPath) return { ok: false, error: 'No folder selected' };
    return installAppFromPath(folderPath);
  },

  /**
   * Install a app from an already-known folder path — no file picker.
   * Used by the app-manager agent tool, where the path is a tool argument.
   */
  async installFromPath(folderPath: string): Promise<AppInstallResponse> {
    return installAppFromPath(folderPath);
  },

  async uninstall(appId: string): Promise<AppActionResponse> {
    try {
      const raw = await client.call<AppActionResponse>('uninstall', { appId });
      return { ok: raw.ok === true, error: raw.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export type { AppActionResponse, AppInstallResponse };
