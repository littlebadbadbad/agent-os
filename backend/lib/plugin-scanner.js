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

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createLogger } from './logger.js';
import { createPluginHost } from './plugin-host.js';
import { createPluginStateStore } from './plugin-state-store.js';
import { DATA_ROOT, PROJECT_ROOT } from './paths.js';
import { readFileSync as _readFileSync } from 'fs';
import { join as _join, dirname as _dirname } from 'path';
import { fileURLToPath as _fileURLToPath } from 'url';

// ── Built-in plugin registry ─────────────────────────────────────────────────
// Single source of truth for which plugins are built-in.
// Both backend (plugin-scanner.js) and UI (pluginSystem.ts) read this file.
// Built-in plugins are always activated and can never be disabled.

const __filename = _fileURLToPath(import.meta.url);
const __dirname = _dirname(__filename);
const BUILT_IN_JSON_PATH = _join(__dirname, '..', '..', 'built-in-plugins.json');

/** @type {ReadonlySet<string>} */
const BUILT_IN_PLUGIN_IDS = (() => {
  try {
    const raw = _readFileSync(BUILT_IN_JSON_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return new Set(data.plugins ?? []);
  } catch {
    return new Set();
  }
})();

/** @param {string} id */
function isBuiltInPlugin(id) {
  return BUILT_IN_PLUGIN_IDS.has(id);
}

export { isBuiltInPlugin };

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
 * @param {import('./plugin-router.js').pluginRouter} router  - Shared PluginRouter instance.
 * @param {string} pluginsDir  - Absolute path to the plugins/ directory.
 * @param {string} dataRoot    - Absolute path to the data/ directory.
 * @param {import('./plugin-host.js').BackendServices} [backendServices]  - Optional backend service accessors.
 * @param {string} [agentDir]  - Optional `.agent/` directory path (passed through to BackendPluginHost.getAgentDir).
 * @returns {{
 *   bootstrap: () => Promise<void>,
 *   scan: () => Promise<import('../../agent-type/plugin.ts').PluginManifest[]>,
 *   activate: (id: string) => Promise<boolean>,
 *   deactivate: (id: string) => Promise<boolean>,
 *   getState: (id: string) => string,
 *   getActivePlugins: () => Array<{ manifest: import('../../agent-type/plugin.ts').PluginManifest, state: string }>,
 *   getPluginManifest: (id: string) => import('../../agent-type/plugin.ts').PluginManifest | undefined,
 * }}
 */
export function createPluginScanner(router, pluginsDir, dataRoot, backendServices = {}, agentDir = null) {
  /** @type {Map<string, { manifest: import('../../agent-type/plugin.ts').PluginManifest, state: string }>} */
  const _plugins = new Map();

  /** Persisted state (disabled flags survive restarts). */
  const stateStore = createPluginStateStore(join(dataRoot, 'plugin-state.json'));

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
        if (isBuiltInPlugin(manifest.id)) {
          // Built-in plugins are always activated — disabled state is ignored.
          const ok = await this.activate(manifest.id);
          if (ok) activated++;
          else failed++;
          continue;
        }
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
     * @returns {Promise<import('../../agent-type/plugin.ts').PluginManifest[]>}
     */
    async scan() {
      const { readdirSync, statSync } = await import('fs');

      /** @type {import('../../agent-type/plugin.ts').PluginManifest[]} */
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
        const host = createPluginHost(name, manifest, router, pluginsDir, dataRoot, backendServices, agentDir);

        // Call activate with the host (R1: error-isolated).
        await Promise.resolve(mod.activate(host));

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
     * If the deactivation should persist across restarts, call
     * stateStore.set(id, 'disabled') + stateStore.save() separately.
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

      // Built-in plugins cannot be deactivated.
      if (isBuiltInPlugin(id)) {
        log.warn(`Cannot deactivate built-in plugin: ${id}`);
        return false;
      }

      // Unregister all routes for this plugin.
      router.unregisterPlugin(id);

      _plugins.set(id, { manifest: existing.manifest, state: STATE_INACTIVE });
      log.info(`Plugin deactivated: ${id}`);
      return true;
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
     * @returns {Array<{ manifest: import('../../agent-type/plugin.ts').PluginManifest, state: string }>}
     */
    getActivePlugins() {
      return Array.from(_plugins.values());
    },

    /**
     * Get a plugin's parsed manifest.
     * @param {string} id
     * @returns {import('../../agent-type/plugin.ts').PluginManifest | undefined}
     */
    getPluginManifest(id) {
      return _plugins.get(id)?.manifest;
    },

    /**
     * Get a wrapped state store that prevents built-in plugins from being disabled.
     */
    getStateStore() {
      const builtIns = new Set(
        Array.from(_plugins.values())
          .filter((p) => isBuiltInPlugin(p.manifest.id))
          .map((p) => p.manifest.id),
      );
      return {
        load: () => stateStore.load(),
        save: () => stateStore.save(),
        get: (id) => stateStore.get(id),
        getAll: () => stateStore.getAll(),
        remove: (id) => stateStore.remove(id),
        set(id, state) {
          if (state === STATE_DISABLED && builtIns.has(id)) {
            log.warn(`Cannot disable built-in plugin: ${id}`);
            return;
          }
          stateStore.set(id, state);
        },
      };
    },
  };
}
