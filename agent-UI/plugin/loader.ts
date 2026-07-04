/**
 * agent-UI/plugin/loader.ts — Dynamic plugin agent entry loader
 *
 * Dynamically imports a plugin's compiled agent entry point at runtime.
 * The entry module is expected to export an `activate` function that
 * receives an `AgentPluginHost`.
 *
 * Path resolution:
 *   - Standalone HTTP (dev): import(`/plugins/<name>/<agentEntry>`)
 *   - Electron: import absolute file path or custom protocol
 *
 * Error wrapping: dynamic import errors include the plugin name for
 * meaningful diagnostics.
 *
 * No classes — pure factory function.
 */

import type { AgentPluginHost } from '@agent-type';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A plugin agent module — the result of importing a plugin's agent entry.
 */
export interface PluginAgentModule {
  /**
   * Activation function called by the plugin system.
   * Receives an AgentPluginHost for registering ToolSets and accessing config.
   */
  activate: (host: AgentPluginHost) => void | Promise<void>;
}

export interface PluginLoadResult {
  /** The module, if loaded successfully. */
  readonly module: PluginAgentModule | null;
  /** Error message if loading failed. */
  readonly error: string | null;
}

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Load a plugin's agent entry via dynamic import.
 *
 * @param pluginId      Plugin id (for error messages).
 * @param agentEntryUrl URL or path to the compiled agent entry file.
 * @returns             A PluginLoadResult with either the module or an error.
 */
export async function loadPluginAgentEntry(
  pluginId: string,
  agentEntryUrl: string,
): Promise<PluginLoadResult> {
  try {
    const mod = await import(
      /* @vite-ignore */ agentEntryUrl
    );

    if (typeof mod.activate !== 'function') {
      return {
        module: null,
        error: `Plugin "${pluginId}" agent entry does not export an activate function`,
      };
    }

    return { module: mod as PluginAgentModule, error: null };
  } catch (err) {
    return {
      module: null,
      error: `Failed to load agent entry for plugin "${pluginId}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
