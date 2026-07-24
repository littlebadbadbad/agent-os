/**
 * agent-UI/plugin/pluginSystem.ts — Plugin lifecycle coordinator (thin factory)
 *
 * Orchestrates the full lifecycle of frontend plugins by delegating to
 * focused sub-modules:
 *
 *   pluginTypes.ts       — All type definitions
 *   pluginBuiltIn.ts     — Compile-time built-in plugin registry
 *   pluginState.ts       — State management and backend fetch helpers
 *   pluginLifecycle.ts   — Plugin activation and enable/disable
 *
 * This module is the public API surface — createPluginSystem() creates a
 * PluginSystem instance that consumers interact with.  Types are re-exported
 * for convenience to minimise import path changes.
 *
 * Usage:
 *   const system = createPluginSystem();
 *   await system.init({ addToolSet, getTools, agentName });
 */

import type { AgentPluginContext } from "./host";
import type {
  ActivatedPluginInfo,
  PluginDescriptor,
  PluginLoadError,
  PluginSystem,
} from "./pluginTypes";
import { createPluginSystemState, fetchPluginList, notifyListeners } from "./pluginState";
import {
  activatePlugin,
  disablePlugin,
  enablePlugin,
} from "./pluginLifecycle";

// ── Re-exports for backward compatibility ────────────────────────────────────

export type { PluginSystem, PluginDescriptor, ActivatedPluginInfo, PluginLoadError } from "./pluginTypes";

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPluginSystem(): PluginSystem {
  const state = createPluginSystemState();

  return {
    subscribe(cb: () => void): () => void {
      state.listeners.add(cb);
      return () => { state.listeners.delete(cb); };
    },

    async init(agentContext: AgentPluginContext): Promise<void> {
      if (state.initialized) return;
      state.initialized = true;
      state.agentContext = agentContext;

      const plugins = await fetchPluginList();
      state.allPlugins = plugins;

      const agentPlugins = plugins.filter(
        (p) => p.hasAgentEntry && p.agentEntryUrl,
      );

      for (const plugin of agentPlugins) {
        plugin.symbols = plugin.symbols ?? [];
        await activatePlugin(state, plugin, agentContext, () => notifyListeners(state));
      }

      notifyListeners(state);
    },

    get activeSymbols(): readonly symbol[] {
      return state.activePlugins.flatMap((p) => p.symbols);
    },

    get activePlugins(): readonly ActivatedPluginInfo[] {
      return state.activePlugins;
    },

    get allPlugins(): readonly PluginDescriptor[] {
      return state.allPlugins;
    },

    get pluginErrors(): readonly PluginLoadError[] {
      return state.pluginErrors;
    },

    getPlugin(pluginId: string): PluginDescriptor | undefined {
      const active = state.activePlugins.find((p) => p.id === pluginId);
      if (active) return active;
      return state.allPlugins.find((p) => p.id === pluginId);
    },

    getActivePlugin(pluginId: string): ActivatedPluginInfo | undefined {
      return state.activePlugins.find((p) => p.id === pluginId);
    },

    async enablePlugin(pluginId: string): Promise<void> {
      await enablePlugin(state, pluginId, () => notifyListeners(state));
    },

    async disablePlugin(pluginId: string): Promise<void> {
      await disablePlugin(state, pluginId, () => notifyListeners(state));
    },

    async refreshPluginList(): Promise<void> {
      const plugins = await fetchPluginList();
      state.allPlugins = plugins;
      notifyListeners(state);
    },

    async activatePluginById(pluginId: string): Promise<void> {
      const plugin = state.allPlugins.find((p) => p.id === pluginId);
      if (!plugin || !plugin.hasAgentEntry || !plugin.agentEntryUrl) return;
      if (state.activePlugins.some((p) => p.id === pluginId)) return;
      if (!state.agentContext) return;

      plugin.symbols = plugin.symbols ?? [];
      await activatePlugin(state, plugin, state.agentContext, () => notifyListeners(state));
      notifyListeners(state);
    },
  };
}
