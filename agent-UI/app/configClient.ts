/**
 * agent-UI/app/configClient.ts — App configuration loader
 *
 * Loads app configuration from the backend, merges with defaults
 * declared in the manifest's `configuration.properties`, and caches
 * the result in memory.
 *
 * Supports dot-separated deep key access:
 *   `getConfig('browser.viewport.width')` → nested property traversal
 *
 * Change notification via `onConfigChanged(cb)` — returns unsubscribe fn.
 * Config is lazy-loaded on first `getConfig()` call.
 *
 * No classes — pure factory function pattern.
 */

import type { AppApiClient, AppManifest } from '@agent-type';

// ── Public interface ──────────────────────────────────────────────────────────

export interface AppConfigClient {
  /**
   * Read a configuration value for this app.
   * Supports dot-separated deep access.
   * Returns the default value from the manifest if not explicitly set.
   */
  getConfig<T = unknown>(key: string): T;

  /**
   * Subscribe to configuration changes.
   * Calls the callback with the full merged config whenever it changes.
   * Returns an unsubscribe function.
   */
  onConfigChanged(cb: (config: Record<string, unknown>) => void): () => void;
}

// ── Internal state (closure-scoped, not a class) ──────────────────────────────

interface ConfigClientState {
  /** The app's manifest with configuration schema. */
  manifest: AppManifest;
  /** The API client for loading/saving config. */
  apiClient: AppApiClient;
  /** Cached merged config (defaults + persisted). null = not loaded yet. */
  cached: Record<string, unknown> | null;
  /** Config change subscribers. */
  subscribers: Set<(config: Record<string, unknown>) => void>;
  /** Whether a load is already in flight (prevents concurrent loads). */
  loading: boolean;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a AppConfigClient for the given manifest and apiClient.
 *
 * Config is lazy-loaded on first access.  The manifest's `configuration.properties`
 * provide default values; persisted overrides from the backend are merged on top.
 *
 * @param manifest   The app's manifest (must include `configuration`).
 * @param apiClient  Pre-bound API client for calling backend config endpoints.
 */
export function createAppConfigClient(
  manifest: AppManifest,
  apiClient: AppApiClient,
): AppConfigClient {
  const state: ConfigClientState = {
    manifest,
    apiClient,
    cached: null,
    subscribers: new Set(),
    loading: false,
  };

  return {
    getConfig<T = unknown>(key: string): T {
      ensureConfigLoaded(state);
      return deepGet(state.cached!, key) as T;
    },

    onConfigChanged(cb: (config: Record<string, unknown>) => void): () => void {
      state.subscribers.add(cb);
      return () => {
        state.subscribers.delete(cb);
      };
    },
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function ensureConfigLoaded(state: ConfigClientState): void {
  if (state.cached !== null) return;
  if (state.loading) return;

  state.loading = true;

  // Load synchronously-ish: kick off async, but since JS is single-threaded
  // and this is only called from getConfig (which is sync), we need to
  // eagerly initialize from defaults first, then update when async completes.
  const defaults = computeDefaults(state.manifest);
  state.cached = { ...defaults };

  // Fire-and-forget async load.  When it resolves, update cache and notify.
  loadConfigFromBackend(state).then((merged) => {
    state.cached = merged;
    state.loading = false;
    for (const cb of state.subscribers) {
      try { cb(merged); } catch { /* subscriber error — swallow */ }
    }
  }).catch(() => {
    state.loading = false;
    // Keep the default-based cache on error.
  });
}

/**
 * Compute the default configuration from the manifest's schema.
 */
function computeDefaults(manifest: AppManifest): Record<string, unknown> {
  const config = manifest.configuration;
  if (!config?.properties) return {};

  const result: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(config.properties)) {
    if (prop.default !== undefined) {
      deepSet(result, key, prop.default);
    }
  }
  return result;
}

/**
 * Load config from the backend via the app's `__get_config` API method.
 * Returns the merged config (backend overrides on top of defaults).
 */
async function loadConfigFromBackend(
  state: ConfigClientState,
): Promise<Record<string, unknown>> {
  const defaults = computeDefaults(state.manifest);
  try {
    const saved = await state.apiClient.call<Record<string, unknown>>('__get_config');
    return { ...defaults, ...saved };
  } catch {
    // Backend not available or method not registered — fall back to defaults.
    return defaults;
  }
}

// ── Deep get/set utilities ────────────────────────────────────────────────────

/**
 * Deeply get a value by dot-separated key path.
 * Returns `undefined` for missing keys.
 */
function deepGet(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Deeply set a value by dot-separated key path.
 * Creates intermediate objects as needed.
 */
function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
