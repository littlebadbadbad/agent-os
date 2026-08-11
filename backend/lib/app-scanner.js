/**
 * backend/lib/app-scanner.js — App lifecycle manager (scanner + activator).
 *
 * Responsibilities:
 *   1. Scan the apps/ directory for valid app manifests
 *   2. Load persisted app state (enabled/disabled)
 *   3. Activate all enabled apps by dynamic-importing their backend entry
 *   4. Provide deactivation and status introspection
 *   5. Isolate errors so one failing app doesn't prevent others from loading
 *
 * bootstrap() is the single entry point — call it before starting the HTTP server.
 *
 * Usage:
 *   import { createAppScanner } from './app-scanner.js';
 *   const scanner = createAppScanner(router, appsDir, dataRoot);
 *   await scanner.bootstrap();
 *
 *   // Later, in HTTP handler:
 *   const match = router.matchHttpRoute(path);
 *   if (match) return send(res, 200, await match.handler(params));
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createLogger } from './logger.js';
import { createAppHost } from './app-host.js';
import { createAppStateStore } from './app-state-store.js';
import { createAppInstaller } from './app-installer.js';
import { createAppServiceRegistry } from './app-services.js';
import builtInApps from '../../built-in-apps.json' with { type: 'json' };

// ── Built-in app registry ─────────────────────────────────────────────────
// Single source of truth for which apps are built-in.
// Both backend (app-scanner.js) and UI (appSystem.ts) read this file.
// Built-in apps can now be disabled like any other app.

/** @type {ReadonlySet<string>} */
const BUILT_IN_APP_IDS = new Set(builtInApps.apps ?? []);

/**
 * 激活顺序（声明顺序 = 依赖顺序：被依赖者在前）。
 * 未在声明列表中的第三方 app 排在其后，按名称字母序保证确定性。
 * @type {ReadonlyMap<string, number>}
 */
const APP_ACTIVATION_ORDER = new Map(
  (builtInApps.apps ?? []).map((id, index) => [id, index]),
);

/** @param {string} id */
function isBuiltInApp(id) {
  return BUILT_IN_APP_IDS.has(id);
}

/** @param {AppManifest} a @param {AppManifest} b */
function byActivationOrder(a, b) {
  const da = APP_ACTIVATION_ORDER.get(a.id) ?? Number.MAX_SAFE_INTEGER;
  const db = APP_ACTIVATION_ORDER.get(b.id) ?? Number.MAX_SAFE_INTEGER;
  return da - db || a.id.localeCompare(b.id);
}

export { isBuiltInApp };

/** @import { AppManifest } from '../../agent-type/app.ts' */
/** @import { appRouter } from './app-router.js' */
/** @import { BackendServices } from './app-host.js' */

const log = createLogger('app-scanner');

// ── App state constants (keep in sync with @agent-type) ───────────────────

/** @type {'inactive'} */
const STATE_INACTIVE = 'inactive';
/** @type {'activating'} */
const STATE_ACTIVATING = 'activating';
/** @type {'active'} */
const STATE_ACTIVE = 'active';
/** @type {'error'} */
const STATE_ERROR = 'error';
/** @type {'disabled'} */
const STATE_DISABLED = 'disabled';

/**
 * Create a app scanner bound to a specific directory and router.
 *
 * @param {appRouter} router  - Shared AppRouter instance.
 * @param {string} appsDir  - Absolute path to the apps/ directory.
 * @param {string} dataRoot    - Absolute path to the data/ directory.
 * @param {BackendServices} [backendServices]  - Optional backend service accessors.
 * @param {string} [agentDir]  - Optional `.agent/` directory path (passed through to BackendAppHost.getAgentDir).
 * @returns {{
 *   bootstrap: () => Promise<void>,
 *   scan: () => Promise<AppManifest[]>,
 *   activate: (id: string) => Promise<boolean>,
 *   deactivate: (id: string) => Promise<boolean>,
 *   enable: (id: string) => Promise<{ ok: boolean, error?: string }>,
 *   disable: (id: string) => Promise<{ ok: boolean, error?: string }>,
 *   install: (sourceType: string, source: Buffer | string) => Promise<{ ok: boolean, error?: string, appId?: string }>,
 *   uninstall: (id: string) => Promise<{ ok: boolean, error?: string }>,
 *   getState: (id: string) => string,
 *   getActiveApps: () => Array<{ manifest: AppManifest, state: string }>,
 *   getAppManifest: (id: string) => AppManifest | undefined,
 * }}
 */
export function createAppScanner(router, appsDir, dataRoot, backendServices = {}, agentDir = null) {
  /** @type {Map<string, { manifest: AppManifest, state: string }>} */
  const _apps = new Map();

  /** Shared inter-app service registry — created once, shared across all app hosts. */
  const _services = createAppServiceRegistry();

  /**
   * Stores the ES module reference returned by dynamic import() for each
   * activated app.  Used to call the app's deactivate() hook during
   * deactivation — symmetric to activate(host).
   * @type {Map<string, { activate: Function, deactivate?: Function }>}
   */
  const _modules = new Map();

  /**
   * Stores the BackendAppHost instance for each activated app.
   * Passed to deactivate(host) so the app can access its sandboxed
   * environment during cleanup.
   * @type {Map<string, object>}
   */
  const _hosts = new Map();

  /** Persisted state (disabled flags survive restarts). */
  const stateStore = createAppStateStore(join(dataRoot, 'app-state.json'));

  /** Filesystem installer for ZIP/folder install and directory removal. */
  const installer = createAppInstaller(appsDir);



  // ── Public API ────────────────────────────────────────────────────────────

  return {
    /**
     * Bootstrap the app system: load persisted state → scan directory →
     * activate all enabled apps.
     *
     * Must be called before the HTTP server starts listening.
     */
    async bootstrap() {
      log.info('Bootstrapping app system…');

      // 1. Load persisted state.
      const persisted = stateStore.load();
      const disabledApps = new Set(
        Object.entries(persisted)
          .filter(([, s]) => s === STATE_DISABLED)
          .map(([name]) => name),
      );
      log.debug(`Persisted disabled apps: ${Array.from(disabledApps).join(', ') || '(none)'}`);

      // 2. Scan for available apps.
      const manifests = await this.scan();

      // Pre-seed _apps with all manifests so activate() doesn't re-scan.
      for (const manifest of manifests) {
        if (!_apps.has(manifest.id)) {
          _apps.set(manifest.id, { manifest, state: STATE_INACTIVE });
        }
      }

      // 3. Activate enabled apps.
      let activated = 0;
      let failed = 0;
      for (const manifest of manifests) {
        if (disabledApps.has(manifest.id)) {
          _apps.set(manifest.id, { manifest, state: STATE_DISABLED });
          log.info(`App disabled (persisted state): ${manifest.id}`);
          continue;
        }
        const ok = await this.activate(manifest.id);
        if (ok) activated++;
        else failed++;
      }

      log.info(`App bootstrap complete: ${activated} activated, ${failed} failed, ${_apps.size} total`);
    },

    /**
     * Scan the apps directory for valid manifests.
     * Returns a list of parsed manifests.
     * @returns {Promise<AppManifest[]>}
     */
    async scan() {

      /** @type {AppManifest[]} */
      const manifests = [];

      if (!existsSync(appsDir)) {
        log.warn(`Apps directory does not exist: ${appsDir}`);
        return manifests;
      }

      let entries;
      try {
        entries = readdirSync(appsDir, { withFileTypes: true });
      } catch (err) {
        log.warn(`Failed to read apps directory: ${err.message}`);
        return manifests;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue; // skip hidden dirs

        const manifestPath = join(appsDir, entry.name, 'manifest.json');
        if (!existsSync(manifestPath)) continue;

        try {
          const raw = readFileSync(manifestPath, 'utf-8');
          const manifest = JSON.parse(raw);

          // Validate minimal manifest fields.
          if (!manifest.id || typeof manifest.id !== 'string') {
            log.warn(`Invalid manifest in ${entry.name}: missing or invalid "id"`);
            continue;
          }
          if (!manifest.name || typeof manifest.name !== 'string') {
            log.warn(`Invalid manifest in ${entry.name}: missing or invalid "name"`);
            continue;
          }
          if (!manifest.version || typeof manifest.version !== 'string') {
            log.warn(`Invalid manifest in ${entry.name}: missing or invalid "version"`);
            continue;
          }

          manifests.push(manifest);
          log.debug(`Found app: ${manifest.id} ("${manifest.name}") v${manifest.version}`);
        } catch (err) {
          log.warn(`Failed to parse manifest for ${entry.name}: ${err.message}`);
        }
      }

      // 按 built-in-apps.json 声明顺序排序 —— 声明顺序即依赖顺序，
      // 保证被依赖的 app（如 terminal）先于依赖者（如 dynamic-tool）激活。
      return manifests.sort(byActivationOrder);
    },

    /**
     * Activate a app by name.
     * Dynamically imports the backend entry point and calls its activate function.
     * Error-isolated: if activation throws, the app is marked 'error' but
     * other apps are unaffected.
     *
     * @param {string} name - App name (must match manifest.name).
     * @returns {Promise<boolean>} true if activation succeeded.
     */
    async activate(name) {
      const existing = _apps.get(name);
      if (existing && existing.state === STATE_ACTIVE) {
        log.debug(`App already active: ${name}`);
        return true;
      }

      // Find the manifest — either from a previous scan or from disk.
      let manifest = existing?.manifest;
      if (!manifest) {
        const manifests = await this.scan();
        manifest = manifests.find((m) => m.name === name);
      }
      if (!manifest) {
        log.warn(`Cannot activate app "${name}": manifest not found`);
        return false;
      }

      // No backend entry — mark as active with no runtime.
      if (!manifest.backendEntry) {
        _apps.set(name, { manifest, state: STATE_ACTIVE });
        log.info(`App activated (no backend entry): ${name}`);
        return true;
      }

      _apps.set(name, { manifest, state: STATE_ACTIVATING });

      try {
        const entryPath = join(appsDir, name, manifest.backendEntry);
        if (!existsSync(entryPath)) {
          throw new Error(`Backend entry not found: ${entryPath}`);
        }

        // Dynamic import (R3: must use import(), not require()).
        // Use pathToFileURL for Windows compatibility — bare "D:\..." paths
        // are rejected by the Node.js ESM loader.
        const mod = await import(
          /* webpackIgnore: true */ /* @vite-ignore */
          pathToFileURL(entryPath).href
        );

        if (typeof mod.activate !== 'function') {
          throw new Error(`App "${name}" backend entry does not export an activate function`);
        }

        // Create sandboxed host.
        const host = createAppHost(name, manifest, router, appsDir, dataRoot, backendServices, agentDir, _services);

        // Call activate with the host (R1: error-isolated).
        await Promise.resolve(mod.activate(host));

        // Store module and host references for symmetric deactivation.
        _modules.set(name, { activate: mod.activate, deactivate: typeof mod.deactivate === 'function' ? mod.deactivate : undefined });
        _hosts.set(name, host);

        _apps.set(name, { manifest, state: STATE_ACTIVE });
        log.info(`App activated: ${name} v${manifest.version}`);
        return true;
      } catch (err) {
        log.error(`Failed to activate app "${name}": ${err.message}`);
        _apps.set(name, { manifest, state: STATE_ERROR });
        return false;
      }
    },

    /**
     * Deactivate a app: unregister all routes and mark as inactive.
     * All apps (including built-in) can be deactivated.
     * Does NOT persist state — callers should use disable() for persistence.
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deactivate(id) {
      const existing = _apps.get(id);
      if (!existing) {
        log.warn(`Cannot deactivate unknown app: ${id}`);
        return false;
      }

      // Call the app's deactivate hook (symmetric to activate).
      // This lets apps clean up long-running processes (Playwright
      // browsers, PTY shells, cron timers, SSE connections).
      const moduleEntry = _modules.get(id);
      if (moduleEntry?.deactivate) {
        const host = _hosts.get(id);
        try {
          await Promise.resolve(moduleEntry.deactivate(host));
          log.info(`App deactivate hook completed: ${id}`);
        } catch (err) {
          log.warn(`App deactivate hook failed for "${id}": ${err.message}`);
          // Don't abort deactivation — best-effort cleanup.
        }
      }

      // Unregister all routes for this app.
      router.unregisterApp(id);

      // Clean up stored references.
      _modules.delete(id);
      _hosts.delete(id);

      _apps.set(id, { manifest: existing.manifest, state: STATE_INACTIVE });
      log.info(`App deactivated: ${id}`);
      return true;
    },

    /**
     * Enable a app: remove persisted disabled state, activate, and persist.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async enable(id) {
      const existing = _apps.get(id);
      if (!existing) {
        return { ok: false, error: `Unknown app: ${id}` };
      }

      // Remove persisted disabled state.
      stateStore.remove(id);
      stateStore.save();

      // Activate the app.
      const ok = await this.activate(id);
      if (!ok) {
        return { ok: false, error: `Failed to activate app: ${id}` };
      }

      log.info(`App enabled: ${id}`);
      return { ok: true };
    },

    /**
     * Disable a app: deactivate, set state to disabled, and persist.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async disable(id) {
      const existing = _apps.get(id);
      if (!existing) {
        return { ok: false, error: `Unknown app: ${id}` };
      }

      // Deactivate the app (unregister routes).
      await this.deactivate(id);

      // Set state to disabled and persist.
      _apps.set(id, { manifest: existing.manifest, state: STATE_DISABLED });
      stateStore.set(id, STATE_DISABLED);
      stateStore.save();

      log.info(`App disabled: ${id}`);
      return { ok: true };
    },

    /**
     * Get the current runtime state of a app.
     * @param {string} id
     * @returns {string}
     */
    getState(id) {
      return _apps.get(id)?.state ?? STATE_INACTIVE;
    },

    /**
     * Get all tracked apps and their current state.
     * @returns {Array<{ manifest: AppManifest, state: string }>}
     */
    getActiveApps() {
      return Array.from(_apps.values());
    },

    /**
     * Get a app's parsed manifest.
     * @param {string} id
     * @returns {AppManifest | undefined}
     */
    getAppManifest(id) {
      return _apps.get(id)?.manifest;
    },

    /**
     * Install a app from a ZIP archive or a source directory.
     *
     * After filesystem install, scans the new app, adds it to _apps,
     * and activates it.
     *
     * @param {'zip' | 'folder'} sourceType
     * @param {Buffer | string} source  - ZIP buffer or absolute folder path.
     * @returns {Promise<{ ok: boolean, error?: string, appId?: string }>}
     */
    async install(sourceType, source) {
      let result;
      if (sourceType === 'zip') {
        result = await installer.installFromZip(/** @type {Buffer} */ (source));
      } else if (sourceType === 'folder') {
        result = await installer.installFromDirectory(/** @type {string} */ (source));
      } else {
        return { ok: false, error: `Invalid source type: "${sourceType}". Must be "zip" or "folder".` };
      }

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      const { appId, manifest } = result;

      // Guard: prevent duplicate registration.  The installer already checks
      // filesystem existence, but we also check the in-memory _apps map
      // to catch edge cases where a partially-uninstalled app left a stale
      // entry (or where two install calls race on the same appId).
      if (_apps.has(appId)) {
        log.warn(`Duplicate install attempt blocked for "${appId}" — already registered`);
        return { ok: false, error: `App "${appId}" is already registered` };
      }

      // Scan the newly installed app to add it to the app map.
      const manifests = await this.scan();
      const newManifest = manifests.find((m) => m.id === appId);

      if (!newManifest) {
        // Should not happen — we just installed it.
        return { ok: false, error: `App "${appId}" installed but manifest not found after scan` };
      }

      // Add to _apps and activate.
      _apps.set(appId, { manifest: newManifest, state: STATE_INACTIVE });
      const activated = await this.activate(appId);

      log.info(`App installed: ${appId} v${manifest.version} (${activated ? 'activated' : 'activation failed'})`);
      return { ok: true, appId };
    },

    /**
     * Uninstall a app: deactivate, remove persisted state, delete its
     * directory from disk, and finally remove from the in-memory map.
     *
     * The in-memory removal happens LAST — only after the filesystem
     * confirms the directory is gone.  This prevents zombie state where
     * the app disappears from the list but its directory remains on
     * disk, permanently blocking reinstall.
     *
     * Built-in apps are NOT uninstallable — only user-installed
     * (external) apps can be removed.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async uninstall(id) {
      const existing = _apps.get(id);
      if (!existing) {
        return { ok: false, error: `Unknown app: ${id}` };
      }

      if (isBuiltInApp(id)) {
        return { ok: false, error: `Built-in app "${id}" cannot be uninstalled` };
      }

      // Deactivate first to unregister backend routes and call cleanup hooks.
      await this.deactivate(id);

      // Remove persisted state.
      stateStore.remove(id);
      stateStore.save();

      // Delete the app directory from disk FIRST.
      // Only after the filesystem confirms success do we remove from
      // the in-memory map — this guarantees that a app still in
      // _apps always has its directory on disk, and vice versa.
      const removeResult = installer.remove(id);
      if (!removeResult.ok) {
        // Directory removal failed — keep the app tracked as inactive
        // so the user can retry.  Do NOT delete from _apps.
        log.warn(`App "${id}" deactivated but directory removal failed: ${removeResult.error}`);
        return { ok: false, error: `Failed to remove app directory: ${removeResult.error}` };
      }

      // Directory confirmed gone — now safe to remove from in-memory map.
      _apps.delete(id);

      log.info(`App uninstalled: ${id}`);
      return { ok: true };
    },

  };
}
