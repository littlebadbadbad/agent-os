/**
 * agent-UI/app/loader.ts — Dynamic app agent entry loader
 *
 * Dynamically imports a app's compiled agent entry point at runtime.
 * The entry module is expected to export an `activate` function that
 * receives an `AgentAppHost`.
 *
 * Path resolution:
 *   - Standalone HTTP (dev): import(`/agent-apps/<name>/<agentEntry>`)
 *   - Electron: import absolute file path or custom protocol
 *
 * Error wrapping: dynamic import errors include the app name for
 * meaningful diagnostics.
 *
 * No classes — pure factory function.
 */

import type { AgentAppHost } from '@agent-type';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A app agent module — the result of importing a app's agent entry.
 */
export interface AppAgentModule {
  /**
   * Activation function called by the app system.
   * Receives an AgentAppHost for registering ToolSets and accessing config.
   */
  activate: (host: AgentAppHost) => void | Promise<void>;
}

export interface AppLoadResult {
  /** The module, if loaded successfully. */
  readonly module: AppAgentModule | null;
  /** Error message if loading failed. */
  readonly error: string | null;
}

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Runtime type guard: confirms a dynamic import result is a AppAgentModule.
 * Uses `in` narrowing (TS 5.5+) then checks the property type — no `as` cast.
 */
function isAppAgentModule(value: unknown): value is AppAgentModule {
  if (typeof value !== 'object' || value === null) return false;
  if (!('activate' in value)) return false;
  return typeof value.activate === 'function';
}

/**
 * Load a app's agent entry via dynamic import.
 *
 * @param appId      App id (for error messages).
 * @param agentEntryUrl URL or path to the compiled agent entry file.
 * @returns             A AppLoadResult with either the module or an error.
 */
export async function loadAppAgentEntry(
  appId: string,
  agentEntryUrl: string,
): Promise<AppLoadResult> {
  try {
    const mod = await import(
      /* @vite-ignore */ agentEntryUrl
    );

    if (!isAppAgentModule(mod)) {
      return {
        module: null,
        error: `App "${appId}" agent entry does not export an activate function`,
      };
    }

    return { module: mod, error: null };
  } catch (err) {
    return {
      module: null,
      error: `Failed to load agent entry for app "${appId}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
