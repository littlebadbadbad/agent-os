/**
 * agent-UI/plugin/pluginTypes.ts — Shared types for the plugin lifecycle system
 */

import type {
  AgentPluginHost,
  PluginBridge,
  PluginSlotDeclaration,
} from "@agent-type";
import { AgentPluginContext } from "./host";

// ── Re-export AgentPluginContext for convenience ─────────────────────────────
export type { AgentPluginContext } from "./host";

// ── Public types ─────────────────────────────────────────────────────────────

export interface PluginDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly state: string;
  readonly builtIn?: boolean;
  readonly canDisable?: boolean;
  readonly hasAgentEntry: boolean;
  readonly agentEntryUrl?: string;
  readonly hasUiEntry: boolean;
  readonly uiEntryUrl?: string;
  symbols: symbol[];
}

/**
 * Raw plugin descriptor from the backend API response.
 * Differs from PluginDescriptor: `symbols` is absent because
 * Symbol cannot be serialized over HTTP.
 */
export interface PluginApiDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly state: string;
  readonly builtIn?: boolean;
  readonly canDisable?: boolean;
  readonly hasAgentEntry: boolean;
  readonly agentEntryUrl?: string;
  readonly hasUiEntry: boolean;
  readonly uiEntryUrl?: string;
}

/** Map an API response descriptor to a full PluginDescriptor. */
export function toPluginDescriptor(api: PluginApiDescriptor): PluginDescriptor {
  return { ...api, symbols: [] };
}

export interface PluginSystem {
  init(agentContext: AgentPluginContext): Promise<void>;
  subscribe(cb: () => void): () => void;
  readonly activePlugins: readonly ActivatedPluginInfo[];
  readonly activeSymbols: readonly symbol[];
  readonly allPlugins: readonly PluginDescriptor[];
  readonly pluginErrors: readonly PluginLoadError[];
  getPlugin(pluginId: string): PluginDescriptor | undefined;
  getActivePlugin(pluginId: string): ActivatedPluginInfo | undefined;
  enablePlugin(pluginId: string): Promise<void>;
  disablePlugin(pluginId: string): Promise<void>;
  refreshPluginList(): Promise<void>;
}

export interface ActivatedPluginInfo extends PluginDescriptor {
  readonly host: AgentPluginHost;
  readonly slotDeclarations: Map<symbol, readonly PluginSlotDeclaration[]>;
  readonly bridge: PluginBridge;
}

export interface PluginLoadError {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly message: string;
}

// ── Internal state ───────────────────────────────────────────────────────────

export interface PluginSystemState {
  activePlugins: ActivatedPluginInfo[];
  allPlugins: PluginDescriptor[];
  pluginErrors: PluginLoadError[];
  initialized: boolean;
  listeners: Set<() => void>;
  unregisterFns: Map<string, () => void>;
  agentContext: AgentPluginContext | null;
}
