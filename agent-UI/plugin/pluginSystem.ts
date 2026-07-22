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
  type PluginBridge,
  type PluginManifest,
  type PluginSlotDeclaration,
} from "@agent-type";
import { createPluginApiClient } from "./apiClient";
import { createPluginConfigClient } from "./configClient";
import { loadPluginAgentEntry, type PluginAgentModule } from "./loader";
import { createAgentPluginHost, type AgentPluginContext } from "./host";
import { providerStore } from "../store/providerStore";

// ── Module augmentation: extend PluginBridge with plugin-manager methods ─────
// This augmentation is also declared in extensions/plugin-manager/agent/activate.ts
// but that file is in a separate compilation context (plugin tsconfig).
// We re-declare it here so the host (pluginSystem.ts) can assign these
// properties to the bridge object with full type safety.
declare module "@agent-type" {
  interface PluginBridge {
    /** Get the current plugin list (descriptors). */
    listPlugins?: () => Promise<readonly {
      id: string;
      name: string;
      version: string;
      description?: string;
      state: string;
      builtIn?: boolean;
      canDisable?: boolean;
      hasAgentEntry: boolean;
      hasUiEntry: boolean;
    }[]>;
    /** Enable a plugin by ID. */
    enablePlugin?: (pluginId: string) => Promise<void>;
    /** Disable a plugin by ID. */
    disablePlugin?: (pluginId: string) => Promise<void>;
    /** Subscribe to plugin list changes. Returns unsubscribe. */
    onPluginListChanged?: (cb: () => void) => () => void;
  }
}

// ── Compile-time built-in plugin registry ────────────────────────────────────
// Baked into the bundle at build time by Vite.  Same source of truth as
// backend/lib/plugin-scanner.js — both read built-in-plugins.json.
import builtInPluginData from "../../built-in-plugins.json";

/** Set of plugin IDs that are built-in and cannot be disabled. */
const BUILT_IN_PLUGIN_IDS: ReadonlySet<string> = new Set(
  builtInPluginData.plugins ?? [],
);

/** @internal Compile-time built-in check (no network dependency). */
export function isBuiltInPlugin(id: string): boolean {
  return BUILT_IN_PLUGIN_IDS.has(id);
}

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
  /** Whether this plugin is built-in (always active, cannot be disabled). */
  readonly builtIn?: boolean;
  /** Whether this plugin can be disabled (plugin-manager cannot). */
  readonly canDisable?: boolean;
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
   * URL to the plugin's UI entry HTML file.
   * Can be a relative path (`/plugins/<id>/ui/index.html`) or an
   * absolute URL (`https://example.com/plugin-ui/`).
   * Only present when hasUiEntry is true.
   */
  readonly uiEntryUrl?: string;
  symbols: symbol[];
}

export interface PluginSystem {
  /**
   * Initialize the plugin system: fetch enabled plugins, load and
   * activate each one.  Error-isolated (R1).
   */
  init(agentContext: AgentPluginContext): Promise<void>;

  /**
   * Subscribe to plugin activation/deactivation changes.
   * Returns an unsubscribe function.
   */
  subscribe(cb: () => void): () => void;

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
   * Plugins whose agent entry failed to load or activate.
   * Useful for diagnostics and visible error feedback.
   */
  get pluginErrors(): readonly PluginLoadError[];

  /**
   * Get a plugin descriptor by its ID.
   * Searches active plugins first (returns {@link ActivatedPluginInfo}
   * with agent APIs and slot declarations if the plugin was activated),
   * then falls back to the raw API descriptor.
   *
   * @param pluginId The ID of the plugin to retrieve.
   * @returns The plugin descriptor, or `undefined` if not found.
   */
  getPlugin(pluginId: string): PluginDescriptor | undefined;

  /**
   * Get an active plugin by ID.
   * Returns `undefined` if the plugin was not activated (agent entry
   * failed to load, or the plugin has no agent entry).
   *
   * @param pluginId The ID of the plugin to retrieve.
   * @returns The activated plugin info with agent APIs and slot
   * declarations, or `undefined` if not active.
   */
  getActivePlugin(pluginId: string): ActivatedPluginInfo | undefined;

  /**
   * Enable a plugin at runtime: call backend enable endpoint, then
   * dynamically import and activate the agent entry.
   * No page reload required.
   *
   * @param pluginId The ID of the plugin to enable.
   */
  enablePlugin(pluginId: string): Promise<void>;

  /**
   * Disable a plugin at runtime: call the plugin's unregister function
   * to remove its ToolSets, then call backend disable endpoint.
   * No page reload required.
   *
   * @param pluginId The ID of the plugin to disable.
   */
  disablePlugin(pluginId: string): Promise<void>;

  /**
   * Re-fetch the plugin list from the backend and update state.
   * Useful after external changes to plugin state.
   */
  refreshPluginList(): Promise<void>;
}

export interface ActivatedPluginInfo extends PluginDescriptor {
  readonly host: AgentPluginHost;
  /** Slot declarations registered by this plugin's ToolSets. */
  readonly slotDeclarations: Map<symbol, readonly PluginSlotDeclaration[]>;
  /**
   * Shared bridge object between agent and UI layer.
   * Agent writes methods/properties during activation; UI reads/calls them.
   * Same reference as `host.bridge` and `UiPluginHost.bridge`.
   */
  readonly bridge: PluginBridge;
}

/**
 * Describes a plugin whose agent entry failed to load or activate.
 */
export interface PluginLoadError {
  readonly pluginId: string;
  readonly pluginName: string;
  /**
   * Error message describing why loading failed.
   * Could be an import error, an `activate()` throw, or a missing export.
   */
  readonly message: string;
}

// ── Internal state ────────────────────────────────────────────────────────────

interface PluginSystemState {
  activePlugins: ActivatedPluginInfo[];
  allPlugins: PluginDescriptor[];
  pluginErrors: PluginLoadError[];
  initialized: boolean;
  listeners: Set<() => void>;
  /** Unregister functions for each active plugin, keyed by plugin ID. */
  unregisterFns: Map<string, () => void>;
  /** Stored agent context for runtime reactivation (set during init). */
  agentContext: AgentPluginContext | null;
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
    pluginErrors: [],
    initialized: false,
    listeners: new Set(),
    unregisterFns: new Map(),
    agentContext: null,
  };

  /** Notify all listeners. */
  const notify = (): void => {
    for (const cb of state.listeners) cb();
  };

  return {
    subscribe(cb: () => void): () => void {
      state.listeners.add(cb);
      return () => { state.listeners.delete(cb); };
    },

    async init(agentContext: AgentPluginContext): Promise<void> {
      if (state.initialized) return;
      state.initialized = true;
      state.agentContext = agentContext;

      const plugins = await fetchEnabledPlugins();
      state.allPlugins = plugins;
      const agentPlugins = plugins.filter(
        (p) => p.hasAgentEntry && p.agentEntryUrl,
      );

      for (const plugin of agentPlugins) {
        plugin.symbols = plugin.symbols ?? [];
        await activatePlugin(state, plugin, agentContext, notify);
      }

      notify();
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

    get pluginErrors(): readonly PluginLoadError[] {
      return state.pluginErrors;
    },

    getPlugin(pluginId: string): PluginDescriptor | undefined {
      // Prefer active plugin (has agent APIs and slot declarations).
      const active = state.activePlugins.find((p) => p.id === pluginId);
      if (active) return active;
      return state.allPlugins.find((p) => p.id === pluginId);
    },

    getActivePlugin(pluginId: string): ActivatedPluginInfo | undefined {
      return state.activePlugins.find((p) => p.id === pluginId);
    },

    async enablePlugin(pluginId: string): Promise<void> {
      await enablePlugin(state, pluginId, notify);
    },

    async disablePlugin(pluginId: string): Promise<void> {
      await disablePlugin(state, pluginId, notify);
    },

    async refreshPluginList(): Promise<void> {
      const plugins = await fetchEnabledPlugins();
      state.allPlugins = plugins;
      notify();
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
    const plugins = body.plugins ?? [];

    // Cross-reference built-in status: if the API omitted `builtIn`,
    // backfill from compile-time JSON.  If there's a mismatch, log a
    // warning — the JSON is the single source of truth.
    for (const p of plugins) {
      const compileBuiltIn = BUILT_IN_PLUGIN_IDS.has(p.id);
      if (p.builtIn === undefined) {
        (p as { builtIn?: boolean }).builtIn = compileBuiltIn;
      } else if (p.builtIn !== compileBuiltIn) {
        console.warn(
          `[pluginSystem] built-in mismatch for "${p.id}": API says ${p.builtIn}, JSON says ${compileBuiltIn}. Using JSON as ground truth.`,
        );
        (p as { builtIn?: boolean }).builtIn = compileBuiltIn;
      }
    }
    return plugins;
  } catch (err) {
    console.warn("[pluginSystem] Error fetching plugin list:", err);
    return [];
  }
}

/**
 * Enable a plugin: call backend, re-fetch list, activate agent entry if present.
 *
 * @param state     Plugin system state.
 * @param pluginId  ID of the plugin to enable.
 * @param notify    Notify function to trigger after changes.
 */
async function enablePlugin(
  state: PluginSystemState,
  pluginId: string,
  notify: () => void,
): Promise<void> {
  // 1. Call backend enable endpoint.
  const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/enable`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.warn(`[pluginSystem] Failed to enable plugin "${pluginId}":`, body);
    return;
  }

  // 2. Re-fetch plugin list to get updated descriptors.
  const plugins = await fetchEnabledPlugins();
  state.allPlugins = plugins;

  // 3. If the plugin has an agent entry and isn't already active, activate it.
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
 * Disable a plugin: unregister agent entry, call backend, re-fetch list.
 *
 * @param state     Plugin system state.
 * @param pluginId  ID of the plugin to disable.
 * @param notify    Notify function to trigger after changes.
 */
async function disablePlugin(
  state: PluginSystemState,
  pluginId: string,
  notify: () => void,
): Promise<void> {
  // 1. Call the plugin's unregister function to remove its ToolSets.
  const unregister = state.unregisterFns.get(pluginId);
  if (unregister) {
    try {
      unregister();
    } catch (err) {
      console.warn(`[pluginSystem] Error unregistering plugin "${pluginId}":`, err);
    }
    state.unregisterFns.delete(pluginId);
  }

  // 2. Remove from active plugins and clear symbols.
  state.activePlugins = state.activePlugins.filter((p) => p.id !== pluginId);

  // 3. Call backend disable endpoint.
  const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/disable`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.warn(`[pluginSystem] Failed to disable plugin "${pluginId}":`, body);
  }

  // 4. Re-fetch plugin list to update state.
  const plugins = await fetchEnabledPlugins();
  state.allPlugins = plugins;

  notify();
}

/**
 * Populate the bridge with plugin management methods for the plugin-manager plugin.
 *
 * This is the access control boundary: only the plugin-manager plugin's bridge
 * gets these methods. Other plugins' bridges remain empty for management operations.
 * The UI iframe calls these via `host.bridge`.
 *
 * @param bridge  The shared bridge object for this plugin.
 * @param state   Plugin system state (for accessing plugin list and methods).
 * @param notify  Notify function to trigger after changes.
 */
function populatePluginManagerBridge(
  bridge: PluginBridge,
  state: PluginSystemState,
  notify: () => void,
): void {
  bridge.listPlugins = async () => {
    return state.allPlugins.map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      state: p.state,
      builtIn: p.builtIn,
      canDisable: p.canDisable,
      hasAgentEntry: p.hasAgentEntry,
      hasUiEntry: p.hasUiEntry,
    }));
  };

  bridge.enablePlugin = async (pluginId: string) => {
    await enablePlugin(state, pluginId, notify);
  };

  bridge.disablePlugin = async (pluginId: string) => {
    await disablePlugin(state, pluginId, notify);
  };

  bridge.onPluginListChanged = (cb: () => void) => {
    state.listeners.add(cb);
    return () => { state.listeners.delete(cb); };
  };
}

/**
 * Activate a single plugin with full error isolation (R1).
 *
 * @param state     Plugin system state.
 * @param plugin    Plugin descriptor to activate.
 * @param agentContext  Agent context for tool registration.
 * @param notify    Function to notify listeners after activation (used for bridge population).
 */
async function activatePlugin(
  state: PluginSystemState,
  plugin: PluginDescriptor,
  agentContext: AgentPluginContext,
  notify: () => void,
): Promise<void> {
  try {
    const agentEntryUrl = plugin.agentEntryUrl!;

    // Step 1: Dynamically import the agent entry.
    const loadResult = await loadPluginAgentEntry(plugin.id, agentEntryUrl);
    if (loadResult.error || !loadResult.module) {
      const errMsg = loadResult.error ?? 'Unknown load error';
      console.warn("[pluginSystem]", errMsg);
      state.pluginErrors = [...state.pluginErrors, {
        pluginId: plugin.id,
        pluginName: plugin.name,
        message: errMsg,
      }];
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

    // Step 4: Create storage for standalone slot declarations and shared bridge.
    const slotDeclarations = new Map<symbol, readonly PluginSlotDeclaration[]>();
    const bridge: PluginBridge = {};

    // Track unregister functions returned by registerToolSet calls.
    // These are stored in state.unregisterFns so disablePlugin can call them.
    const toolSetUnregisterFns: Array<() => void> = [];

    // Step 5: Create the sandboxed host.
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

    // Wrap registerToolSet to capture the unregister function.
    const originalRegisterToolSet = host.registerToolSet;
    host.registerToolSet = (toolSet, slots?) => {
      const unregister = originalRegisterToolSet(toolSet, slots);
      toolSetUnregisterFns.push(unregister);
      return unregister;
    };

    // Step 6: Call activate — this is where the plugin registers ToolSets
    // and populates `host.bridge` with its methods/properties.
    await Promise.resolve(loadResult.module.activate(host));

    // Step 6b: For the plugin-manager plugin, populate the bridge with
    // management methods. This is the access control boundary — only the
    // plugin-manager plugin gets management methods on its bridge.
    // Other plugins' bridges remain empty for management operations.
    if (plugin.id === "plugin-manager") {
      populatePluginManagerBridge(bridge, state, notify);
    }

    // Store the combined unregister function for this plugin.
    if (toolSetUnregisterFns.length > 0) {
      state.unregisterFns.set(plugin.id, () => {
        for (const fn of toolSetUnregisterFns) {
          try { fn(); } catch (err) {
            console.warn(`[pluginSystem] Error in unregister for "${plugin.id}":`, err);
          }
        }
      });
    }

    state.activePlugins.push({
      host,
      slotDeclarations,
      bridge,
      ...plugin,
    });
    console.info(
      `[pluginSystem] Activated plugin: ${plugin.id} ("${plugin.name}") v${plugin.version}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[pluginSystem] Failed to activate plugin "${plugin.id}":`,
      errMsg,
    );
    state.pluginErrors = [...state.pluginErrors, {
      pluginId: plugin.id,
      pluginName: plugin.name,
      message: errMsg,
    }];
    // R1: failure of one plugin does not affect others.
  }
}
