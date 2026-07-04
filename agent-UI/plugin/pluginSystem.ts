/**
 * agent-UI/plugin/pluginSystem.ts — Plugin lifecycle coordinator
 *
 * Orchestrates the full lifecycle of frontend plugins:
 *   1. Fetch enabled plugin list from the backend
 *   2. For each plugin that has an agent entry:
 *      a. Dynamically import the agent entry module
 *      b. Create a pre-bound API client
 *      c. Create a configuration client (lazy-loaded)
 *      d. Create the AgentPluginHost
 *      e. Call the plugin's activate function
 *   3. Error isolation (R1): one plugin failure never blocks others
 *
 * No classes — pure factory function pattern.
 */

import {
  resolveToolSetTools,
  type AgentPluginHost,
  type PluginManifest,
} from "@agent-type";
import { createPluginApiClient } from "./apiClient";
import { createPluginConfigClient } from "./configClient";
import { loadPluginAgentEntry, type PluginAgentModule } from "./loader";
import { createAgentPluginHost, type AgentPluginContext } from "./host";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Plugin descriptor returned by the backend `/api/plugins` endpoint.
 * Extended to include whether the plugin has an agentEntry.
 */
export interface PluginDescriptor {
  /** Unique plugin identifier (kebab-case). */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly state: string;
  /** Whether this plugin has an agent entry point. */
  readonly hasAgentEntry: boolean;
  /**
   * URL path to the compiled agent entry file.
   * Only present when hasAgentEntry is true.
   * Example: `/plugins/<id>/agent/index.js`
   */
  readonly agentEntryUrl?: string;
  /** Whether this plugin has a UI entry point. */
  readonly hasUiEntry: boolean;
  /**
   * URL path to the plugin's UI entry HTML file.
   * Only present when hasUiEntry is true.
   * Example: `/plugins/<id>/ui/index.html`
   */
  readonly uiEntryUrl?: string;
  /**
   * Declares the list of tools that this plugin provides. Used by the host to
   * determine which plugin to route a tool call to.
   */
  tools: string[];
  symbols: symbol[];
}

export interface PluginSystem {
  /**
   * Initialize the plugin system: fetch enabled plugins, load and
   * activate each one.  Error-isolated (R1).
   */
  init(agentContext: AgentPluginContext): Promise<void>;

  /**
   * All plugins that were successfully activated.
   */
  get activePlugins(): readonly ActivatedPluginInfo[];
  get activeSymbols(): readonly symbol[];

  /**
   * All plugin descriptors fetched from the backend (regardless of
   * whether they have an agent entry).  Includes UI-only plugins.
   */
  get allPlugins(): readonly PluginDescriptor[];
  /**
   * Get a plugin descriptor by its ID.
   * @param pluginId The ID of the plugin to retrieve.
   */
  getPlugin(pluginId: string): PluginDescriptor | undefined;
}

export interface ActivatedPluginInfo extends PluginDescriptor {
  readonly host: AgentPluginHost;
}

// ── Internal state ────────────────────────────────────────────────────────────

interface PluginSystemState {
  activePlugins: ActivatedPluginInfo[];
  allPlugins: PluginDescriptor[];
  initialized: boolean;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a new PluginSystem instance.
 *
 * Usage:
 *   const system = createPluginSystem();
 *   await system.init({ addToolSet, getRegisteredToolSets, getTools, agentName });
 */
export function createPluginSystem(): PluginSystem {
  const state: PluginSystemState = {
    activePlugins: [],
    allPlugins: [],
    initialized: false,
  };

  return {
    async init(agentContext: AgentPluginContext): Promise<void> {
      if (state.initialized) return;
      state.initialized = true;

      const plugins = await fetchEnabledPlugins();
      state.allPlugins = plugins;
      const agentPlugins = plugins.filter(
        (p) => p.hasAgentEntry && p.agentEntryUrl,
      );

      for (const plugin of agentPlugins) {
        plugin.tools = plugin.tools ?? [];
        plugin.symbols = plugin.symbols ?? [];
        await activatePlugin(state, plugin, agentContext);
      }
    },
    get activeSymbols(): readonly symbol[] {
      return state.activePlugins.map((p) => p.symbols).flat();
    },

    get activePlugins(): readonly ActivatedPluginInfo[] {
      return state.activePlugins;
    },

    get allPlugins(): readonly PluginDescriptor[] {
      return state.allPlugins;
    },
    getPlugin(pluginId: string): PluginDescriptor | undefined {
      return state.allPlugins.find((p) => p.id === pluginId);
    },
  };
}

// ── Internal ───────────────────────────────────────────────────────────────────

/**
 * Fetch the list of enabled plugins from the backend.
 */
async function fetchEnabledPlugins(): Promise<PluginDescriptor[]> {
  try {
    const res = await fetch("/api/plugins");
    if (!res.ok) {
      console.warn("[pluginSystem] Failed to fetch plugin list:", res.status);
      return [];
    }
    const body = (await res.json()) as { plugins?: PluginDescriptor[] };
    return body.plugins ?? [];
  } catch (err) {
    console.warn("[pluginSystem] Error fetching plugin list:", err);
    return [];
  }
}

/**
 * Activate a single plugin with full error isolation (R1).
 */
async function activatePlugin(
  state: PluginSystemState,
  plugin: PluginDescriptor,
  agentContext: AgentPluginContext,
): Promise<void> {
  try {
    const agentEntryUrl = plugin.agentEntryUrl!;

    // Step 1: Dynamically import the agent entry.
    const loadResult = await loadPluginAgentEntry(plugin.id, agentEntryUrl);
    if (loadResult.error || !loadResult.module) {
      console.warn("[pluginSystem]", loadResult.error);
      return;
    }

    // Step 2: Create pre-bound API client (bound by plugin id).
    const apiClient = createPluginApiClient(plugin.id);

    // Step 3: Create config client (lazy-loaded on first getConfig call).
    const manifest: PluginManifest = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
    };
    const configClient = createPluginConfigClient(manifest, apiClient);

    // Step 4: Create the sandboxed host.
    const host = createAgentPluginHost({
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginVersion: plugin.version,
      apiClient,
      configClient,
      agentContext,
      attatchToolSets: (toolSet) => {
        plugin.tools.push(...resolveToolSetTools(toolSet).map((t) => t.name));
        if (toolSet.symbol && !plugin.symbols.includes(toolSet.symbol)) {
          plugin.symbols.push(toolSet.symbol);
        }
      },
    });
    // Step 5: Call activate — this is where the plugin registers ToolSets.
    await Promise.resolve(loadResult.module.activate(host));

    state.activePlugins.push({
      host,
      ...plugin
    });
    console.info(
      `[pluginSystem] Activated plugin: ${plugin.id} ("${plugin.name}") v${plugin.version}`,
    );
  } catch (err) {
    console.warn(
      `[pluginSystem] Failed to activate plugin "${plugin.id}":`,
      err instanceof Error ? err.message : String(err),
    );
    // R1: failure of one plugin does not affect others.
  }
}
