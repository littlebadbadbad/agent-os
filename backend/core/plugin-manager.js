/**
 * backend/core/plugin-manager.js — Super built-in "plugin-manager" plugin
 *
 * Registers plugin management API methods via defineApi().
 *
 * This replaces the inline plugin management routes previously in backend/index.js.
 *
 * Methods:
 *   list          → List all plugins
 *   getConfig     → Load plugin config
 *   saveConfig    → Save plugin config
 *   enable        → Enable a plugin
 *   disable       → Disable a plugin
 *   installZip    → Install from ZIP buffer
 *   installFolder → Install from folder path
 *   uninstall     → Uninstall a plugin (external only)
 */

import { createCorePluginHost } from '../lib/core-plugin-host.js';
import builtInPlugins from '../../built-in-plugins.json' with { type: 'json' };

const PLUGIN_ID = 'plugin-manager';
const BUILT_IN_PLUGIN_IDS = new Set(builtInPlugins.plugins ?? []);

/** @param {import('../lib/plugin-router.js').pluginRouter} router */
export function register(router, deps) {
  const host = createCorePluginHost(PLUGIN_ID, router);

  /** @type {import('../lib/plugin-scanner.js').PluginScanner} */
  const scanner = deps.pluginScanner;

  /** @type {import('../lib/plugin-config-store.js').PluginConfigStore} */
  const configStore = deps.pluginConfigStore;

  host.defineApi('list', async () => {
    const plugins = scanner.getActivePlugins().map((p) => {
      const manifest = p.manifest;
      return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        state: p.state,
        builtIn: BUILT_IN_PLUGIN_IDS.has(manifest.id),
        canDisable: true,
        hasAgentEntry: !!manifest.agentEntry,
        agentEntryUrl: manifest.agentEntry
          ? `/plugins/${manifest.id}/${manifest.agentEntry.replace(/\\/g, '/')}`
          : undefined,
        hasUiEntry: !!manifest.uiEntry,
        uiEntryUrl: manifest.uiEntry
          ? isAbsoluteUrl(manifest.uiEntry)
            ? manifest.uiEntry
            : `/plugins/${manifest.id}/${manifest.uiEntry.replace(/\\/g, '/')}`
          : undefined,
      };
    });

    return { plugins };
  });

  host.defineApi('getConfig', async (params) => {
    const pluginId = params?.pluginId;
    if (!pluginId) throw new Error('pluginId is required');
    const manifest = scanner.getPluginManifest(pluginId);
    return configStore.load(pluginId, manifest);
  });

  host.defineApi('saveConfig', async (params) => {
    const { pluginId, config } = params ?? {};
    if (!pluginId) throw new Error('pluginId is required');
    if (typeof config !== 'object' || config === null) throw new Error('config must be a JSON object');
    configStore.save(pluginId, config);
    return { ok: true };
  });

  host.defineApi('enable', async (params) => {
    const pluginId = params?.pluginId;
    if (!pluginId) throw new Error('pluginId is required');
    return scanner.enable(pluginId);
  });

  host.defineApi('disable', async (params) => {
    const pluginId = params?.pluginId;
    if (!pluginId) throw new Error('pluginId is required');
    return scanner.disable(pluginId);
  });

  host.defineApi('installZip', async (params) => {
    const { zipBase64 } = params ?? {};
    if (!zipBase64 || typeof zipBase64 !== 'string') throw new Error('zipBase64 (base64-encoded ZIP) is required');
    const zipBuffer = Buffer.from(zipBase64, 'base64');
    return scanner.install('zip', zipBuffer);
  });

  host.defineApi('installFolder', async (params) => {
    const sourcePath = params?.path;
    if (!sourcePath || typeof sourcePath !== 'string') throw new Error('"path" is required');
    return scanner.install('folder', sourcePath);
  });

  host.defineApi('uninstall', async (params) => {
    const pluginId = params?.pluginId;
    if (!pluginId) throw new Error('pluginId is required');
    return scanner.uninstall(pluginId);
  });
}

function isAbsoluteUrl(s) {
  return /^(https?:)?\/\//i.test(s);
}
