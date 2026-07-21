/**
 * agent-UI/plugin/host.ts — AgentPluginHost factory
 *
 * Creates an AgentPluginHost instance that is the sandboxed interface
 * a plugin receives during activation.  The host provides:
 *
 *   - `registerToolSet(toolSet)` — register tools on the agent
 *   - `apiClient` — pre-bound (no pluginId param) cross-environment client
 *   - `getConfig(key)` / `onConfigChanged(cb)` — configuration access
 *   - `pluginId` / `pluginName` / `pluginVersion` — plugin identity metadata
 *
 * All config values and the API client are injected; the host is a pure
 * delegation layer with no runtime dependency on the plugin system.
 *
 * No classes — pure factory function.
 */

import type { AgentPluginHost, PluginBridge, PluginApiClient, ToolSet, ModelMeta, PluginSlotDeclaration } from '@agent-type';
import type { Tool } from '@agent-type/core';
import type { PluginConfigClient } from './configClient';

// ── Agent context ─────────────────────────────────────────────────────────────

/**
 * Minimal agent interface that the host needs to register tools.
 * This abstracts the actual agent client so the plugin runtime doesn't
 * depend on the full agent implementation.
 */
export interface AgentPluginContext {
  /** Register a ToolSet on the agent. Returns an unregister function. */
  addToolSet(toolSet: ToolSet): () => void;
  /** All ToolSets currently registered. */
  getRegisteredToolSets(): readonly ToolSet[];
  /** All master tools (unfiltered). */
  getTools(): readonly Tool[];
  /** The agent's name/identifier. */
  readonly agentName: string;
}

// ── Factory params ────────────────────────────────────────────────────────────

export interface AgentPluginHostParams {
  /** Plugin identifier (kebab-case, matches manifest.id). */
  readonly pluginId: string;
  /** Plugin display name (human-readable, matches manifest.name). */
  readonly pluginName: string;
  /** Plugin version (SemVer). */
  readonly pluginVersion: string;
  /** Pre-bound API client for plugin backend communication. */
  readonly apiClient: PluginApiClient;
  /** Configuration client for plugin settings. */
  readonly configClient: PluginConfigClient;
  /** Agent context for tool registration. */
  readonly agentContext: AgentPluginContext;
  /** Function to add tools to the plugin. */
  readonly attatchToolSets: (toolSet: ToolSet) => void;
  /** Store slot declarations for this plugin's ToolSet. */
  readonly storeSlotDeclarations: (toolSetSymbol: symbol, slots: readonly PluginSlotDeclaration[]) => void;
  /**
   * Shared bridge object — same reference exposed to the UI iframe.
   * Plugin writes methods/properties here during activation;
   * UI reads/calls them via `host.bridge`.
   */
  readonly bridge: PluginBridge;
  /** Returns the currently selected model metadata. */
  readonly getSelectedModel: () => ModelMeta;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an AgentPluginHost for the given plugin.
 *
 * The host is a lightweight delegation layer — it does NOT own the
 * ToolSet or config lifecycle; it merely exposes the injected services.
 *
 * @param params  Factory parameters.
 * @returns       An AgentPluginHost instance.
 */
export function createAgentPluginHost(params: AgentPluginHostParams): AgentPluginHost {
  const { pluginId, pluginName, pluginVersion, apiClient, configClient, agentContext, attatchToolSets, storeSlotDeclarations, bridge, getSelectedModel } = params;

  return {
    registerToolSet(toolSet: ToolSet, slots?: readonly PluginSlotDeclaration[]): () => void {
      const sym = toolSet.symbol ?? (
        console.warn(`[host] ToolSet "${toolSet.name}" (plugin "${pluginId}") is missing a symbol — using fallback. Slot declarations may not match session state.`),
        Symbol.for(`agent:slot:${pluginId}:${toolSet.name}`)
      );
      if (slots) {
        storeSlotDeclarations(sym, slots);
      }
      attatchToolSets(toolSet);
      return agentContext.addToolSet(toolSet);
    },

    get bridge(): PluginBridge { return bridge; },

    getRegisteredToolSets(): readonly ToolSet[] {
      return agentContext.getRegisteredToolSets();
    },

    getTools(): readonly Tool[] {
      return agentContext.getTools();
    },

    get agentName(): string {
      return agentContext.agentName;
    },

    get apiClient(): PluginApiClient {
      return apiClient;
    },

    getConfig<T = unknown>(key: string): T {
      return configClient.getConfig<T>(key);
    },

    onConfigChanged(cb: (config: Record<string, unknown>) => void): () => void {
      return configClient.onConfigChanged(cb);
    },

    get pluginId(): string {
      return pluginId;
    },

    get pluginName(): string {
      return pluginName;
    },

    get pluginVersion(): string {
      return pluginVersion;
    },

    getSelectedModel(): ModelMeta {
      return getSelectedModel();
    },
  };
}
