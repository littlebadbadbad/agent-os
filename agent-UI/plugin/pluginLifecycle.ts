/**
 * agent-UI/plugin/pluginLifecycle.ts — Plugin lifecycle operations
 *
 * Core plugin runtime operations: activation, enable/disable.
 * Install/uninstall/reinstall are handled by `pluginManagerApi` in the
 * `agent-UI/pluginManager/` module — no longer routed through PluginBridge.
 *
 * Each function operates on a shared PluginSystemState and calls
 * notifyListeners() after state changes.
 *
 * No circular dependencies — this module imports from pluginState, pluginTypes,
 * and lower-level plugin utilities.  The thin factory in pluginSystem.ts
 * wires everything together.
 */

import type { PluginBridge, PluginManifest, PluginSlotDeclaration } from "@agent-type";
import { createPluginApiClient } from "./apiClient";
import { createPluginConfigClient } from "./configClient";
import { loadPluginAgentEntry } from "./loader";
import { createAgentPluginHost } from "./host";
import { providerStore } from "../store/providerStore";
import type { AgentPluginContext } from "./host";
import type { PluginDescriptor, PluginSystemState } from "./pluginTypes";
import { fetchPluginList } from "./pluginState";
import { pluginManagerApi } from "./core/plugin-manager";

// ═══════════════════════════════════════════════════════════════════════════════
//  Activation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Activate a single plugin: import agent entry → create host → call activate.
 * Error-isolated (R1): one failure never blocks others.
 */
export async function activatePlugin(
  state: PluginSystemState,
  plugin: PluginDescriptor,
  agentContext: AgentPluginContext,
  notify: () => void,
): Promise<void> {
  try {
    const agentEntryUrl = plugin.agentEntryUrl!;

    const loadResult = await loadPluginAgentEntry(plugin.id, agentEntryUrl);
    if (loadResult.error || !loadResult.module) {
      const errMsg = loadResult.error ?? "Unknown load error";
      console.warn("[pluginSystem]", errMsg);
      state.pluginErrors = [
        ...state.pluginErrors,
        { pluginId: plugin.id, pluginName: plugin.name, message: errMsg },
      ];
      return;
    }

    const apiClient = createPluginApiClient(plugin.id);

    const manifest: PluginManifest = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
    };
    const configClient = createPluginConfigClient(manifest, apiClient);

    const slotDeclarations = new Map<symbol, readonly PluginSlotDeclaration[]>();
    const bridge: PluginBridge = {};
    const toolSetUnregisterFns: Array<() => void> = [];

    const host = createAgentPluginHost({
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginVersion: plugin.version,
      apiClient,
      configClient,
      agentContext,
      bridge,
      attatchToolSets: (toolSet) => {
        const sym = toolSet.symbol ?? Symbol.for(`agent:slot:${plugin.id}:${toolSet.name}`);
        if (!plugin.symbols.includes(sym)) {
          plugin.symbols.push(sym);
        }
      },
      storeSlotDeclarations: (toolSetSymbol, slots) => {
        slotDeclarations.set(toolSetSymbol, slots);
      },
      getSelectedModel: () => providerStore.getSelectedModel(),
    });

    const originalRegisterToolSet = host.registerToolSet;
    host.registerToolSet = (toolSet, slots?) => {
      // ── Inject internal brand for built-in plugins ───────────────────
      // This marks every ToolSet from a built-in plugin as "internal",
      // granting privileged capabilities (e.g. suppressToolSetPrompt).
      // External plugins cannot reproduce the symbol, so they never
      // receive these privileges.
      if (plugin.builtIn && agentContext.internalBrand) {
        (toolSet as Record<symbol, unknown>)[agentContext.internalBrand] = true;
      }

      const unregister = originalRegisterToolSet(toolSet, slots);
      toolSetUnregisterFns.push(unregister);
      return unregister;
    };

    await Promise.resolve(loadResult.module.activate(host));

    if (toolSetUnregisterFns.length > 0) {
      state.unregisterFns.set(plugin.id, () => {
        for (const fn of toolSetUnregisterFns) {
          try { fn(); } catch (err) {
            console.warn(`[pluginSystem] Error in unregister for "${plugin.id}":`, err);
          }
        }
      });
    }

    state.activePlugins.push({ host, slotDeclarations, bridge, ...plugin });
    console.info(
      `[pluginSystem] Activated plugin: ${plugin.id} ("${plugin.name}") v${plugin.version}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[pluginSystem] Failed to activate plugin "${plugin.id}":`, errMsg);
    state.pluginErrors = [
      ...state.pluginErrors,
      { pluginId: plugin.id, pluginName: plugin.name, message: errMsg },
    ];
    // R1: failure of one plugin does not affect others.
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Enable / Disable
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enable a plugin: call backend enable → re-fetch list → activate agent entry.
 */
export async function enablePlugin(
  state: PluginSystemState,
  pluginId: string,
  notify: () => void,
): Promise<void> {
  const result = await pluginManagerApi.enable(pluginId);
  if (!result.ok) {
    console.warn(`[pluginSystem] Failed to enable plugin "${pluginId}"`);
    return;
  }

  const plugins = await fetchPluginList();
  state.allPlugins = plugins;

  const plugin = plugins.find((p) => p.id === pluginId);
  if (!plugin || !plugin.hasAgentEntry || !plugin.agentEntryUrl) {
    notify();
    return;
  }
  if (state.activePlugins.some((p) => p.id === pluginId)) {
    notify();
    return;
  }

  plugin.symbols = plugin.symbols ?? [];
  if (state.agentContext) {
    await activatePlugin(state, plugin, state.agentContext, notify);
  }

  notify();
}

/**
 * Disable a plugin: unregister agent entry → call backend → re-fetch list.
 */
export async function disablePlugin(
  state: PluginSystemState,
  pluginId: string,
  notify: () => void,
): Promise<void> {
  const unregister = state.unregisterFns.get(pluginId);
  if (unregister) {
    try { unregister(); } catch (err) {
      console.warn(`[pluginSystem] Error unregistering plugin "${pluginId}":`, err);
    }
    state.unregisterFns.delete(pluginId);
  }

  state.activePlugins = state.activePlugins.filter((p) => p.id !== pluginId);

  await pluginManagerApi.disable(pluginId);

  state.allPlugins = await fetchPluginList();
  notify();
}
