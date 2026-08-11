/**
 * backend/core/app-manager.js — Super built-in "app-manager" app
 *
 * Registers app management API methods via defineApi().
 *
 * This replaces the inline app management routes previously in backend/index.js.
 *
 * Methods:
 *   list          → List all apps
 *   getConfig     → Load app config
 *   saveConfig    → Save app config
 *   enable        → Enable a app
 *   disable       → Disable a app
 *   installZip    → Install from ZIP buffer
 *   installFolder → Install from folder path
 *   uninstall     → Uninstall a app (external only)
 */

import { createCoreAppHost } from '../lib/core-app-host.js';
import builtInApps from '../../built-in-apps.json' with { type: 'json' };

const APP_ID = 'app-manager';
const BUILT_IN_APP_IDS = new Set(builtInApps.apps ?? []);

/** @param {import('../lib/app-router.js').appRouter} router */
export function register(router, deps) {
  const host = createCoreAppHost(APP_ID, router);

  /** @type {import('../lib/app-scanner.js').AppScanner} */
  const scanner = deps.appScanner;

  /** @type {import('../lib/app-config-store.js').AppConfigStore} */
  const configStore = deps.appConfigStore;

  host.defineApi('list', async () => {
    const apps = scanner.getActiveApps().map((p) => {
      const manifest = p.manifest;
      return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        state: p.state,
        builtIn: BUILT_IN_APP_IDS.has(manifest.id),
        canDisable: true,
        hasAgentEntry: !!manifest.agentEntry,
        agentEntryUrl: manifest.agentEntry
          ? `/agent-apps/${manifest.id}/${manifest.agentEntry.replace(/\\/g, '/')}`
          : undefined,
        hasUiEntry: !!manifest.uiEntry,
        uiEntryUrl: manifest.uiEntry
          ? isAbsoluteUrl(manifest.uiEntry)
            ? manifest.uiEntry
            : `/agent-apps/${manifest.id}/${manifest.uiEntry.replace(/\\/g, '/')}`
          : undefined,
      };
    });

    return { apps };
  });

  host.defineApi('getConfig', async (params) => {
    const appId = params?.appId;
    if (!appId) throw new Error('appId is required');
    const manifest = scanner.getAppManifest(appId);
    return configStore.load(appId, manifest);
  });

  host.defineApi('saveConfig', async (params) => {
    const { appId, config } = params ?? {};
    if (!appId) throw new Error('appId is required');
    if (typeof config !== 'object' || config === null) throw new Error('config must be a JSON object');
    configStore.save(appId, config);
    return { ok: true };
  });

  host.defineApi('enable', async (params) => {
    const appId = params?.appId;
    if (!appId) throw new Error('appId is required');
    return scanner.enable(appId);
  });

  host.defineApi('disable', async (params) => {
    const appId = params?.appId;
    if (!appId) throw new Error('appId is required');
    return scanner.disable(appId);
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
    const appId = params?.appId;
    if (!appId) throw new Error('appId is required');
    return scanner.uninstall(appId);
  });
}

function isAbsoluteUrl(s) {
  return /^(https?:)?\/\//i.test(s);
}
