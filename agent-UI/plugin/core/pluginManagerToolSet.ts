/**
 * agent-UI/plugin/core/pluginManagerToolSet.ts — Plugin Manager agent ToolSet
 *
 * Lets the agent inspect and manage plugins conversationally: list, enable,
 * disable, install, uninstall. Mutations that affect the agent entry
 * (enable/disable/install) go through `PluginSystem` so tool registration
 * and slot cleanup stay in sync — never the raw `pluginManagerApi` alone.
 *
 * Built-in plugins are protected from uninstallation.
 *
 * Always registered directly on both agents (see agent-UI/agents.ts) —
 * plugin management is core capability, not itself a toggleable plugin.
 */

import { z } from "zod";
import { defineTool } from "@agent-type/defineTool";
import type { ToolSet } from "@agent-type";
import type { PluginSystem } from "../pluginTypes";
import { pluginManagerApi } from "./plugin-manager";

export const PLUGIN_MANAGER_TOOLSET_SYMBOL = Symbol("plugin-manager-toolset");

const SYSTEM_PROMPT = `## Plugin Manager
Every capability in this app (terminal, file, git, browser, ...) is a plugin — built-in or user-installed. Use these tools to inspect and manage them:
- \`list_plugins\` — see every plugin's id, state (active/disabled) and whether it can be disabled. Call this first to find the right \`pluginId\`.
- \`enable_plugin\` / \`disable_plugin\` — toggle an installed plugin. Disabling removes its tools/UI immediately; plugins with \`canDisable: false\` are core and cannot be disabled.
- \`install_plugin\` — install from a local folder that contains a \`manifest.json\`.
- \`uninstall_plugin\` — permanently remove a user-installed plugin (disables it first if active). Built-in plugins cannot be uninstalled.
After any mutation, call \`list_plugins\` again if you need to confirm the resulting state.`;

/** Build the plugin-manager ToolSet, bound to a live `PluginSystem` instance. */
export function createPluginManagerToolSet(pluginSystem: PluginSystem): ToolSet {
  const listPluginsTool = defineTool({
    name: "list_plugins",
    group: "Plugin Manager",
    description: "List all plugins with id, state, and whether they can be disabled.",
    parameters: z.object({}),
    execute: async () => {
      await pluginSystem.refreshPluginList();
      return pluginSystem.allPlugins.map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version,
        description: p.description,
        state: p.state,
        builtIn: p.builtIn ?? false,
        canDisable: p.canDisable ?? true,
      }));
    },
  });

  const enablePluginTool = defineTool({
    name: "enable_plugin",
    group: "Plugin Manager",
    description: "Enable a disabled plugin by id.",
    parameters: z.object({
      pluginId: z.string().describe('Plugin id, e.g. "terminal"'),
    }),
    execute: async ({ pluginId }) => {
      await pluginSystem.enablePlugin(pluginId);
      const plugin = pluginSystem.getPlugin(pluginId);
      if (!plugin) return { ok: false, error: `Plugin "${pluginId}" not found` };
      return { ok: plugin.state === "active", state: plugin.state };
    },
  });

  const disablePluginTool = defineTool({
    name: "disable_plugin",
    group: "Plugin Manager",
    description: "Disable an active plugin by id.",
    parameters: z.object({
      pluginId: z.string().describe('Plugin id, e.g. "terminal"'),
    }),
    isDestructive: true,
    execute: async ({ pluginId }) => {
      const plugin = pluginSystem.getPlugin(pluginId);
      if (plugin?.canDisable === false) {
        return { ok: false, error: `Plugin "${pluginId}" cannot be disabled` };
      }
      await pluginSystem.disablePlugin(pluginId);
      return { ok: true };
    },
  });

  const installPluginTool = defineTool({
    name: "install_plugin",
    group: "Plugin Manager",
    description: "Install a plugin from a local folder containing manifest.json.",
    parameters: z.object({
      folderPath: z.string().describe("Absolute path to the plugin source folder"),
    }),
    execute: async ({ folderPath }) => {
      const result = await pluginManagerApi.installFromPath(folderPath);
      if (!result.ok) return result;
      await pluginSystem.refreshPluginList();
      if (result.pluginId) await pluginSystem.activatePluginById(result.pluginId);
      return result;
    },
  });

  const uninstallPluginTool = defineTool({
    name: "uninstall_plugin",
    group: "Plugin Manager",
    description: "Permanently remove a user-installed plugin by id. Built-in plugins cannot be uninstalled.",
    parameters: z.object({
      pluginId: z.string(),
    }),
    isDestructive: true,
    execute: async ({ pluginId }) => {
      const plugin = pluginSystem.getPlugin(pluginId);
      if (plugin?.builtIn) {
        return { ok: false, error: `Built-in plugin "${pluginId}" cannot be uninstalled` };
      }
      if (pluginSystem.getActivePlugin(pluginId)) {
        await pluginSystem.disablePlugin(pluginId);
      }
      const result = await pluginManagerApi.uninstall(pluginId);
      // Always refresh — success or failure, the plugin state may have changed.
      await pluginSystem.refreshPluginList();
      return result;
    },
  });

  return {
    symbol: PLUGIN_MANAGER_TOOLSET_SYMBOL,
    name: "plugin-manager",
    coreTools: ["list_plugins"],
    tools: [
      listPluginsTool,
      enablePluginTool,
      disablePluginTool,
      installPluginTool,
      uninstallPluginTool,
    ],
    onGetSystemPrompt: () => SYSTEM_PROMPT,
  };
}
