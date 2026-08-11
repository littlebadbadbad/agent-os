/**
 * agent-UI/app/core/appManagerToolSet.ts — App Manager agent ToolSet
 *
 * Lets the agent inspect and manage apps conversationally: list, enable,
 * disable, install, uninstall. Mutations that affect the agent entry
 * (enable/disable/install) go through `AppSystem` so tool registration
 * and slot cleanup stay in sync — never the raw `appManagerApi` alone.
 *
 * Built-in apps are protected from uninstallation.
 *
 * Always registered directly on both agents (see agent-UI/agents.ts) —
 * app management is core capability, not itself a toggleable app.
 */

import { z } from "zod";
import { defineTool } from "@agent-type/defineTool";
import type { ToolSet } from "@agent-type";
import type { AppSystem } from "../appTypes";
import { appManagerApi } from "./app-manager";

export const APP_MANAGER_TOOLSET_SYMBOL = Symbol("app-manager-toolset");

const SYSTEM_PROMPT = `## App Manager
Every capability in this app (terminal, file, git, browser, ...) is a app — built-in or user-installed. Use these tools to inspect and manage them:
- \`list_apps\` — see every app's id, state (active/disabled) and whether it can be disabled. Call this first to find the right \`appId\`.
- \`enable_app\` / \`disable_app\` — toggle an installed app. Disabling removes its tools/UI immediately; apps with \`canDisable: false\` are core and cannot be disabled.
- \`install_app\` — install from a local folder that contains a \`manifest.json\`.
- \`uninstall_app\` — permanently remove a user-installed app (disables it first if active). Built-in apps cannot be uninstalled.
After any mutation, call \`list_apps\` again if you need to confirm the resulting state.`;

/** Build the app-manager ToolSet, bound to a live `AppSystem` instance. */
export function createAppManagerToolSet(appSystem: AppSystem): ToolSet {
  const listAppsTool = defineTool({
    name: "list_apps",
    group: "App Manager",
    description: "List all apps with id, state, and whether they can be disabled.",
    parameters: z.object({}),
    execute: async () => {
      await appSystem.refreshAppList();
      return appSystem.allApps.map((p) => ({
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

  const enableAppTool = defineTool({
    name: "enable_app",
    group: "App Manager",
    description: "Enable a disabled app by id.",
    parameters: z.object({
      appId: z.string().describe('App id, e.g. "terminal"'),
    }),
    execute: async ({ appId }) => {
      await appSystem.enableApp(appId);
      const app = appSystem.getApp(appId);
      if (!app) return { ok: false, error: `App "${appId}" not found` };
      return { ok: app.state === "active", state: app.state };
    },
  });

  const disableAppTool = defineTool({
    name: "disable_app",
    group: "App Manager",
    description: "Disable an active app by id.",
    parameters: z.object({
      appId: z.string().describe('App id, e.g. "terminal"'),
    }),
    isDestructive: true,
    execute: async ({ appId }) => {
      const app = appSystem.getApp(appId);
      if (app?.canDisable === false) {
        return { ok: false, error: `App "${appId}" cannot be disabled` };
      }
      await appSystem.disableApp(appId);
      return { ok: true };
    },
  });

  const installAppTool = defineTool({
    name: "install_app",
    group: "App Manager",
    description: "Install a app from a local folder containing manifest.json.",
    parameters: z.object({
      folderPath: z.string().describe("Absolute path to the app source folder"),
    }),
    execute: async ({ folderPath }) => {
      const result = await appManagerApi.installFromPath(folderPath);
      if (!result.ok) return result;
      await appSystem.refreshAppList();
      if (result.appId) await appSystem.activateAppById(result.appId);
      return result;
    },
  });

  const uninstallAppTool = defineTool({
    name: "uninstall_app",
    group: "App Manager",
    description: "Permanently remove a user-installed app by id. Built-in apps cannot be uninstalled.",
    parameters: z.object({
      appId: z.string(),
    }),
    isDestructive: true,
    execute: async ({ appId }) => {
      const app = appSystem.getApp(appId);
      if (app?.builtIn) {
        return { ok: false, error: `Built-in app "${appId}" cannot be uninstalled` };
      }
      if (appSystem.getActiveApp(appId)) {
        await appSystem.disableApp(appId);
      }
      const result = await appManagerApi.uninstall(appId);
      // Always refresh — success or failure, the app state may have changed.
      await appSystem.refreshAppList();
      return result;
    },
  });

  return {
    symbol: APP_MANAGER_TOOLSET_SYMBOL,
    name: "app-manager",
    coreTools: ["list_apps"],
    tools: [
      listAppsTool,
      enableAppTool,
      disableAppTool,
      installAppTool,
      uninstallAppTool,
    ],
    onGetSystemPrompt: () => SYSTEM_PROMPT,
  };
}
