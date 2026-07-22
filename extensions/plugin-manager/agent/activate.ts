/**
 * extensions/plugin-manager/agent/activate.ts — Plugin Manager agent entry
 *
 * Registers an app slot (desktop icon → floating window) with NO tools.
 * The AI cannot list/enable/disable plugins — this is a pure UI plugin.
 *
 * Bridge pattern: the host (pluginSystem.ts) detects the plugin-manager
 * plugin during activation and populates `host.bridge` with management
 * methods (listPlugins, enablePlugin, disablePlugin, onPluginListChanged).
 * The UI iframe calls these via `host.bridge`.
 *
 * This file only registers the app slot — the bridge is populated by the host.
 */

import type { AgentPluginHost, ToolSet, PluginSlotDeclaration } from "@agent-type";

// ── Module augmentation: extend PluginBridge with plugin-manager methods ─────

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

// ── App slot declaration ─────────────────────────────────────────────────────

const PLUGIN_MANAGER_SLOTS: readonly PluginSlotDeclaration[] = [
  {
    type: "app",
    icon: "🧩",
    label: "Plugin Manager",
    order: 10,
    defaultWidth: 640,
    defaultHeight: 560,
    resizable: true,
    minimizable: true,
  },
];

// ── Activate ─────────────────────────────────────────────────────────────────

/**
 * Activate the plugin-manager plugin.
 *
 * Registers a ToolSet with an app slot and NO tools.
 * The host (pluginSystem.ts) populates the bridge with management methods.
 *
 * @param host  The AgentPluginHost for this plugin.
 */
export function activate(host: AgentPluginHost): void {
  const toolSet: ToolSet = {
    symbol: Symbol.for("plugin-manager:app"),
    name: "plugin-manager",
    description: "Plugin lifecycle manager — enable, disable, and inspect plugins.",
    tools: () => [],
  };

  host.registerToolSet(toolSet, PLUGIN_MANAGER_SLOTS);
}
