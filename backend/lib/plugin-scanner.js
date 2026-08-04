/**
 * backend/lib/plugin-scanner.js — Plugin lifecycle manager (scanner + activator).
 *
 * Responsibilities:
 *   1. Scan the plugins/ directory for valid plugin manifests
 *   2. Load persisted plugin state (enabled/disabled)
 *   3. Activate all enabled plugins by dynamic-importing their backend entry
 *   4. Provide deactivation and status introspection
 *   5. Isolate errors so one failing plugin doesn't prevent others from loading
 *
 * bootstrap() is the single entry point — call it before starting the HTTP server.
 *
 * Usage:
 *   import { createPluginScanner } from './plugin-scanner.js';
 *   const scanner = createPluginScanner(router, pluginsDir, dataRoot);
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
import { createPluginHost } from './plugin-host.js';
import { createPluginStateStore } from './plugin-state-store.js';
import { createPluginInstaller } from './plugin-installer.js';
import { createPluginServiceRegistry } from './plugin-services.js';
import builtInPlugins from '../../built-in-plugins.json' with { type: 'json' };

// ── Built-in plugin registry ─────────────────────────────────────────────────
// Single source of truth for which plugins are built-in.
// Both backend (plugin-scanner.js) and UI (pluginSystem.ts) read this file.
// Built-in plugins can now be disabled like any other plugin.

/** @type {ReadonlySet<string>} */
const BUILT_IN_PLUGIN_IDS = new Set(builtInPlugins.plugins ?? []);

/** @param {string} id */
function isBuiltInPlugin(id) {
  return BUILT_IN_PLUGIN_IDS.has(id);
}

export { isBuiltInPlugin };

/** @import { PluginManifest } from '../../agent-type/plugin.ts' */
/** @import { pluginRouter } from './plugin-router.js' */
/** @import { BackendServices } from './plugin-host.js' */

const log = createLogger('plugin-scanner');

// ── Plugin state constants (keep in sync with @agent-type) ───────────────────

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
 * Create a plugin scanner bound to a specific directory and router.
 *
 * @param {pluginRouter} router  - Shared PluginRouter instance.
 * @param {string} pluginsDir  - Absolute path to the plugins/ directory.
 * @param {string} dataRoot    - Absolute path to the data/ directory.
 * @param {BackendServices} [backendServices]  - Optional backend service accessors.
 * @param {string} [agentDir]  - Optional `.agent/` directory path (passed through to BackendPluginHost.getAgentDir).
 * @returns {{
 *   bootstrap: () => Promise<void>,
 *   scan: () => Promise<PluginManifest[]>,
 *   activate: (id: string) => Promise<boolean>,
 *   deactivate: (id: string) => Promise<boolean>,
 *   enable: (id: string) => Promise<{ ok: boolean, error?: string }>,
 *   disable: (id: string) => Promise<{ ok: boolean, error?: string }>,
 *   install: (sourceType: string, source: Buffer | string) => Promise<{ ok: boolean, error?: string, pluginId?: string }>,
 *   uninstall: (id: string) => Promise<{ ok: boolean, error?: string }>,
 *   getState: (id: string) => string,
 *   getActivePlugins: () => Array<{ manifest: PluginManifest, state: string }>,
 *   getPluginManifest: (id: string) => PluginManifest | undefined,
 * }}
 */
export function createPluginScanner(router, pluginsDir, dataRoot, backendServices = {}, agentDir = null) {
  /** @type {Map<string, { manifest: PluginManifest, state: string }>} */
  const _plugins = new Map();

  /** Shared inter-plugin service registry — created once, shared across all plugin hosts. */
  const _services = createPluginServiceRegistry();

  /**
   * Stores the ES module reference returned by dynamic import() for each
   * activated plugin.  Used to call the plugin's deactivate() hook during
   * deactivation — symmetric to activate(host).
   * @type {Map<string, { activate: Function, deactivate?: Function }>}
   */
  const _modules = new Map();

  /**
   * Stores the BackendPluginHost instance for each activated plugin.
   * Passed to deactivate(host) so the plugin can access its sandboxed
   * environment during cleanup.
   * @type {Map<string, object>}
   */
  const _hosts = new Map();

  /** Persisted state (disabled flags survive restarts). */
  const stateStore = createPluginStateStore(join(dataRoot, 'plugin-state.json'));

  /** Filesystem installer for ZIP/folder install and directory removal. */
  const installer = createPluginInstaller(pluginsDir);



  // ── Public API ────────────────────────────────────────────────────────────

  return {
    /**
     * Bootstrap the plugin system: load persisted state → scan directory →
     * activate all enabled plugins.
     *
     * Must be called before the HTTP server starts listening.
     */
    async bootstrap() {
      log.info('Bootstrapping plugin system…');

      // 1. Load persisted state.
      const persisted = stateStore.load();
      const disabledPlugins = new Set(
        Object.entries(persisted)
          .filter(([, s]) => s === STATE_DISABLED)
          .map(([name]) => name),
      );
      log.debug(`Persisted disabled plugins: ${Array.from(disabledPlugins).join(', ') || '(none)'}`);

      // 2. Scan for available plugins.
      const manifests = await this.scan();

      // Pre-seed _plugins with all manifests so activate() doesn't re-scan.
      for (const manifest of manifests) {
        if (!_plugins.has(manifest.id)) {
          _plugins.set(manifest.id, { manifest, state: STATE_INACTIVE });
        }
      }

      // 3. Activate enabled plugins.
      let activated = 0;
      let failed = 0;
      for (const manifest of manifests) {
        if (disabledPlugins.has(manifest.id)) {
          _plugins.set(manifest.id, { manifest, state: STATE_DISABLED });
          log.info(`Plugin disabled (persisted state): ${manifest.id}`);
          continue;
        }
        const ok = await this.activate(manifest.id);
        if (ok) activated++;
        else failed++;
      }

      log.info(`Plugin bootstrap complete: ${activated} activated, ${failed} failed, ${_plugins.size} total`);
    },

    /**
     * Scan the plugins directory for valid manifests.
     * Returns a list of parsed manifests.
     * @returns {Promise<PluginManifest[]>}
     */
    async scan() {

      /** @type {PluginManifest[]} */
      const manifests = [];

      if (!existsSync(pluginsDir)) {
        log.warn(`Plugins directory does not exist: ${pluginsDir}`);
        return manifests;
      }

      let entries;
      try {
        entries = readdirSync(pluginsDir, { withFileTypes: true });
      } catch (err) {
        log.warn(`Failed to read plugins directory: ${err.message}`);
        return manifests;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue; // skip hidden dirs

        const manifestPath = join(pluginsDir, entry.name, 'manifest.json');
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
          log.debug(`Found plugin: ${manifest.id} ("${manifest.name}") v${manifest.version}`);
        } catch (err) {
          log.warn(`Failed to parse manifest for ${entry.name}: ${err.message}`);
        }
      }

      return manifests;
    },

    /**
     * Activate a plugin by name.
     * Dynamically imports the backend entry point and calls its activate function.
     * Error-isolated: if activation throws, the plugin is marked 'error' but
     * other plugins are unaffected.
     *
     * @param {string} name - Plugin name (must match manifest.name).
     * @returns {Promise<boolean>} true if activation succeeded.
     */
    async activate(name) {
      const existing = _plugins.get(name);
      if (existing && existing.state === STATE_ACTIVE) {
        log.debug(`Plugin already active: ${name}`);
        return true;
      }

      // Find the manifest — either from a previous scan or from disk.
      let manifest = existing?.manifest;
      if (!manifest) {
        const manifests = await this.scan();
        manifest = manifests.find((m) => m.name === name);
      }
      if (!manifest) {
        log.warn(`Cannot activate plugin "${name}": manifest not found`);
        return false;
      }

      // No backend entry — mark as active with no runtime.
      if (!manifest.backendEntry) {
        _plugins.set(name, { manifest, state: STATE_ACTIVE });
        log.info(`Plugin activated (no backend entry): ${name}`);
        return true;
      }

      _plugins.set(name, { manifest, state: STATE_ACTIVATING });

      try {
        const entryPath = join(pluginsDir, name, manifest.backendEntry);
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
          throw new Error(`Plugin "${name}" backend entry does not export an activate function`);
        }

        // Create sandboxed host.
        const host = createPluginHost(name, manifest, router, pluginsDir, dataRoot, backendServices, agentDir, _services);

        // Call activate with the host (R1: error-isolated).
        await Promise.resolve(mod.activate(host));

        // Store module and host references for symmetric deactivation.
        _modules.set(name, { activate: mod.activate, deactivate: typeof mod.deactivate === 'function' ? mod.deactivate : undefined });
        _hosts.set(name, host);

        _plugins.set(name, { manifest, state: STATE_ACTIVE });
        log.info(`Plugin activated: ${name} v${manifest.version}`);
        return true;
      } catch (err) {
        log.error(`Failed to activate plugin "${name}": ${err.message}`);
        _plugins.set(name, { manifest, state: STATE_ERROR });
        return false;
      }
    },

    /**
     * Deactivate a plugin: unregister all routes and mark as inactive.
     * All plugins (including built-in) can be deactivated.
     * Does NOT persist state — callers should use disable() for persistence.
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deactivate(id) {
      const existing = _plugins.get(id);
      if (!existing) {
        log.warn(`Cannot deactivate unknown plugin: ${id}`);
        return false;
      }

      // Call the plugin's deactivate hook (symmetric to activate).
      // This lets plugins clean up long-running processes (Playwright
      // browsers, PTY shells, cron timers, SSE connections).
      const moduleEntry = _modules.get(id);
      if (moduleEntry?.deactivate) {
        const host = _hosts.get(id);
        try {
          await Promise.resolve(moduleEntry.deactivate(host));
          log.info(`Plugin deactivate hook completed: ${id}`);
        } catch (err) {
          log.warn(`Plugin deactivate hook failed for "${id}": ${err.message}`);
          // Don't abort deactivation — best-effort cleanup.
        }
      }

      // Unregister all routes for this plugin.
      router.unregisterPlugin(id);

      // Clean up stored references.
      _modules.delete(id);
      _hosts.delete(id);

      _plugins.set(id, { manifest: existing.manifest, state: STATE_INACTIVE });
      log.info(`Plugin deactivated: ${id}`);
      return true;
    },

    /**
     * Enable a plugin: remove persisted disabled state, activate, and persist.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async enable(id) {
      const existing = _plugins.get(id);
      if (!existing) {
        return { ok: false, error: `Unknown plugin: ${id}` };
      }

      // Remove persisted disabled state.
      stateStore.remove(id);
      stateStore.save();

      // Activate the plugin.
      const ok = await this.activate(id);
      if (!ok) {
        return { ok: false, error: `Failed to activate plugin: ${id}` };
      }

      log.info(`Plugin enabled: ${id}`);
      return { ok: true };
    },

    /**
     * Disable a plugin: deactivate, set state to disabled, and persist.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async disable(id) {
      const existing = _plugins.get(id);
      if (!existing) {
        return { ok: false, error: `Unknown plugin: ${id}` };
      }

      // Deactivate the plugin (unregister routes).
      await this.deactivate(id);

      // Set state to disabled and persist.
      _plugins.set(id, { manifest: existing.manifest, state: STATE_DISABLED });
      stateStore.set(id, STATE_DISABLED);
      stateStore.save();

      log.info(`Plugin disabled: ${id}`);
      return { ok: true };
    },

    /**
     * Get the current runtime state of a plugin.
     * @param {string} id
     * @returns {string}
     */
    getState(id) {
      return _plugins.get(id)?.state ?? STATE_INACTIVE;
    },

    /**
     * Get all tracked plugins and their current state.
     * @returns {Array<{ manifest: PluginManifest, state: string }>}
     */
    getActivePlugins() {
      return Array.from(_plugins.values());
    },

    /**
     * Get a plugin's parsed manifest.
     * @param {string} id
     * @returns {PluginManifest | undefined}
     */
    getPluginManifest(id) {
      return _plugins.get(id)?.manifest;
    },

    /**
     * Install a plugin from a ZIP archive or a source directory.
     *
     * After filesystem install, scans the new plugin, adds it to _plugins,
     * and activates it.
     *
     * @param {'zip' | 'folder'} sourceType
     * @param {Buffer | string} source  - ZIP buffer or absolute folder path.
     * @returns {Promise<{ ok: boolean, error?: string, pluginId?: string }>}
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

      const { pluginId, manifest } = result;

      // Guard: prevent duplicate registration.  The installer already checks
      // filesystem existence, but we also check the in-memory _plugins map
      // to catch edge cases where a partially-uninstalled plugin left a stale
      // entry (or where two install calls race on the same pluginId).
      if (_plugins.has(pluginId)) {
        log.warn(`Duplicate install attempt blocked for "${pluginId}" — already registered`);
        return { ok: false, error: `Plugin "${pluginId}" is already registered` };
      }

      // Scan the newly installed plugin to add it to the plugin map.
      const manifests = await this.scan();
      const newManifest = manifests.find((m) => m.id === pluginId);

      if (!newManifest) {
        // Should not happen — we just installed it.
        return { ok: false, error: `Plugin "${pluginId}" installed but manifest not found after scan` };
      }

      // Add to _plugins and activate.
      _plugins.set(pluginId, { manifest: newManifest, state: STATE_INACTIVE });
      const activated = await this.activate(pluginId);

      log.info(`Plugin installed: ${pluginId} v${manifest.version} (${activated ? 'activated' : 'activation failed'})`);
      return { ok: true, pluginId };
    },

    /**
     * Uninstall a plugin: deactivate, remove persisted state, delete its
     * directory from disk, and finally remove from the in-memory map.
     *
     * The in-memory removal happens LAST — only after the filesystem
     * confirms the directory is gone.  This prevents zombie state where
     * the plugin disappears from the list but its directory remains on
     * disk, permanently blocking reinstall.
     *
     * Built-in plugins are NOT uninstallable — only user-installed
     * (external) plugins can be removed.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async uninstall(id) {
      const existing = _plugins.get(id);
      if (!existing) {
        return { ok: false, error: `Unknown plugin: ${id}` };
      }

      if (isBuiltInPlugin(id)) {
        return { ok: false, error: `Built-in plugin "${id}" cannot be uninstalled` };
      }

      // Deactivate first to unregister backend routes and call cleanup hooks.
      await this.deactivate(id);

      // Remove persisted state.
      stateStore.remove(id);
      stateStore.save();

      // Delete the plugin directory from disk FIRST.
      // Only after the filesystem confirms success do we remove from
      // the in-memory map — this guarantees that a plugin still in
      // _plugins always has its directory on disk, and vice versa.
      const removeResult = installer.remove(id);
      if (!removeResult.ok) {
        // Directory removal failed — keep the plugin tracked as inactive
        // so the user can retry.  Do NOT delete from _plugins.
        log.warn(`Plugin "${id}" deactivated but directory removal failed: ${removeResult.error}`);
        return { ok: false, error: `Failed to remove plugin directory: ${removeResult.error}` };
      }

      // Directory confirmed gone — now safe to remove from in-memory map.
      _plugins.delete(id);

      log.info(`Plugin uninstalled: ${id}`);
      return { ok: true };
    },

  };
}
