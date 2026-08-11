/**
 * agent-UI/app/host.ts — AgentAppHost factory
 *
 * Creates an AgentAppHost instance that is the sandboxed interface
 * a app receives during activation.  The host provides:
 *
 *   - `registerToolSet(toolSet)` — register tools on the agent
 *   - `apiClient` — pre-bound (no appId param) cross-environment client
 *   - `getConfig(key)` / `onConfigChanged(cb)` — configuration access
 *   - `appId` / `appName` / `appVersion` — app identity metadata
 *
 * All config values and the API client are injected; the host is a pure
 * delegation layer with no runtime dependency on the app system.
 *
 * No classes — pure factory function.
 */

import type { AgentAppHost, AppBridge, AppApiClient, ToolSet, ModelMeta, SlotDeclaration } from '@agent-type';
import type { Tool } from '@agent-type/core';
import type { AppConfigClient } from './configClient';

// ── Agent context ─────────────────────────────────────────────────────────────

/**
 * Minimal agent interface that the host needs to register tools.
 * This abstracts the actual agent client so the app runtime doesn't
 * depend on the full agent implementation.
 */
export interface AgentAppContext {
  /** Register a ToolSet on the agent. Returns an unregister function. */
  addToolSet(toolSet: ToolSet): () => void;
  /** All ToolSets currently registered. */
  getRegisteredToolSets(): readonly ToolSet[];
  /** All master tools (unfiltered). */
  getTools(): readonly Tool[];
  /** The agent's name/identifier. */
  readonly agentName: string;
  /**
   * Internal brand symbol — identifies "built-in" ToolSets.
   * When set, the app lifecycle injects this brand into every built-in
   * app's ToolSet at registration time, granting them privileged
   * capabilities (e.g. system-prompt suppression).
   */
  readonly internalBrand?: symbol;
}

// ── Factory params ────────────────────────────────────────────────────────────

export interface AgentAppHostParams {
  /** App identifier (kebab-case, matches manifest.id). */
  readonly appId: string;
  /** App display name (human-readable, matches manifest.name). */
  readonly appName: string;
  /** App version (SemVer). */
  readonly appVersion: string;
  /** Pre-bound API client for app backend communication. */
  readonly apiClient: AppApiClient;
  /** Configuration client for app settings. */
  readonly configClient: AppConfigClient;
  /** Agent context for tool registration. */
  readonly agentContext: AgentAppContext;
  /** Function to add tools to the app. */
  readonly attatchToolSets: (toolSet: ToolSet) => void;
  /** Store slot declarations for this app's ToolSet. */
  readonly storeSlotDeclarations: (toolSetSymbol: symbol, slots: readonly SlotDeclaration[]) => void;
  /**
   * Shared bridge object — same reference exposed to the UI iframe.
   * App writes methods/properties here during activation;
   * UI reads/calls them via `host.bridge`.
   */
  readonly bridge: AppBridge;
  /** Returns the currently selected model metadata. */
  readonly getSelectedModel: () => ModelMeta;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an AgentAppHost for the given app.
 *
 * The host is a lightweight delegation layer — it does NOT own the
 * ToolSet or config lifecycle; it merely exposes the injected services.
 *
 * @param params  Factory parameters.
 * @returns       An AgentAppHost instance.
 */
export function createAgentAppHost(params: AgentAppHostParams): AgentAppHost {
  const { appId, appName, appVersion, apiClient, configClient, agentContext, attatchToolSets, storeSlotDeclarations, bridge, getSelectedModel } = params;

  return {
    registerToolSet(toolSet: ToolSet, slots?: readonly SlotDeclaration[]): () => void {
      if (!toolSet.symbol) {
        toolSet.symbol = Symbol.for(`agent:slot:${appId}:${toolSet.name}`);
      }
      if (slots) {
        storeSlotDeclarations(toolSet.symbol, slots);
      }
      attatchToolSets(toolSet);
      return agentContext.addToolSet(toolSet);
    },

    get bridge(): AppBridge { return bridge; },

    getRegisteredToolSets(): readonly ToolSet[] {
      return agentContext.getRegisteredToolSets();
    },

    getTools(): readonly Tool[] {
      return agentContext.getTools();
    },

    get agentName(): string {
      return agentContext.agentName;
    },

    get apiClient(): AppApiClient {
      return apiClient;
    },

    getConfig<T = unknown>(key: string): T {
      return configClient.getConfig<T>(key);
    },

    onConfigChanged(cb: (config: Record<string, unknown>) => void): () => void {
      return configClient.onConfigChanged(cb);
    },

    get appId(): string {
      return appId;
    },

    get appName(): string {
      return appName;
    },

    get appVersion(): string {
      return appVersion;
    },

    getSelectedModel(): ModelMeta {
      return getSelectedModel();
    },
  };
}
