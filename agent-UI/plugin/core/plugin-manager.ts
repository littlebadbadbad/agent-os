/**
 * agent-UI/plugin/core/plugin-manager.ts — Super built-in "plugin-manager" plugin API
 *
 * Typed wrappers around plugin management backend API methods.
 * All calls go through PluginApiClient (dual HTTP/IPC transport).
 *
 * This replaces the old pluginManagerApi (agent-UI/pluginManager/pluginManagerApi.ts)
 * which used apiTransport directly.
 */

import { createPluginApiClient } from '../apiClient';
import type { PluginInfo } from '../pluginTypes';

const client = createPluginApiClient('plugin-manager');

interface PluginActionResponse {
  readonly ok?: boolean;
  readonly error?: string;
}

interface PluginInstallResponse {
  readonly ok?: boolean;
  readonly error?: string;
  readonly pluginId?: string;
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
  return prompt('Enter the absolute path to the plugin folder:');
}

// ── Public API ───────────────────────────────────────────────────────────────

export const pluginManagerApi = {
  async list(): Promise<readonly PluginInfo[]> {
    try {
      const res = await client.call<{ plugins: readonly PluginInfo[] }>('list');
      return Array.isArray(res.plugins) ? res.plugins : [];
    } catch {
      return [];
    }
  },

  async getConfig(pluginId: string): Promise<Record<string, unknown>> {
    return client.call<Record<string, unknown>>('getConfig', { pluginId });
  },

  async saveConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
    await client.call('saveConfig', { pluginId, config });
  },

  async enable(pluginId: string): Promise<PluginActionResponse> {
    try {
      const raw = await client.call<PluginActionResponse>('enable', { pluginId });
      return { ok: raw.ok === true, error: raw.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async disable(pluginId: string): Promise<PluginActionResponse> {
    try {
      const raw = await client.call<PluginActionResponse>('disable', { pluginId });
      return { ok: raw.ok === true, error: raw.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async installFromZip(): Promise<PluginInstallResponse> {
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

      const raw = await client.call<PluginInstallResponse>('installZip', { zipBase64 });
      return { ok: raw.ok === true, error: raw.error, pluginId: raw.pluginId };
    } catch (err) {
      return { ok: false, error: `Install failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async installFromFolder(): Promise<PluginInstallResponse> {
    const folderPath = await pickFolder();
    if (!folderPath) return { ok: false, error: 'No folder selected' };

    try {
      const raw = await client.call<PluginInstallResponse>('installFolder', { path: folderPath });
      return { ok: raw.ok === true, error: raw.error, pluginId: raw.pluginId };
    } catch (err) {
      return { ok: false, error: `Install failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async uninstall(pluginId: string): Promise<PluginActionResponse> {
    try {
      const raw = await client.call<PluginActionResponse>('uninstall', { pluginId });
      return { ok: raw.ok === true, error: raw.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async reinstallBuiltIn(pluginId: string): Promise<PluginActionResponse> {
    try {
      const raw = await client.call<PluginActionResponse>('reinstall', { pluginId });
      return { ok: raw.ok === true, error: raw.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export type { PluginActionResponse, PluginInstallResponse };
