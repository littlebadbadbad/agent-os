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

const client = createPluginApiClient('plugin-manager');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PluginInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly state: string;
  readonly builtIn?: boolean;
  readonly canDisable?: boolean;
  readonly hasAgentEntry: boolean;
  readonly hasUiEntry: boolean;
  readonly agentEntryUrl?: string;
  readonly uiEntryUrl?: string;
}

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

function isDialogResult(value: unknown): value is { canceled: boolean; filePaths: readonly string[] } {
  if (typeof value !== 'object' || value === null) return false;
  return 'canceled' in value && 'filePaths' in value
    && Array.isArray((value as Record<string, unknown>).filePaths);
}

async function pickFolder(): Promise<string | null> {
  const ea = (window as unknown as Record<string, unknown>).electronAPI as Record<string, unknown> | undefined;
  if (typeof ea?.invoke === 'function') {
    try {
      const result = await (ea.invoke as (ch: string) => Promise<unknown>)('dialog:openDirectory');
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
      const buffer = await file.arrayBuffer();
      const zipBuffer = Array.from(new Uint8Array(buffer));
      const raw = await client.call<PluginInstallResponse>('installZip', { zipBuffer });
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
