/**
 * agent-UI/plugin/pluginLifecycle.ts — Plugin lifecycle operations
 *
 * All runtime plugin operations: activation, enable/disable, install/uninstall,
 * reinstall, and bridge population.  Each function operates on a shared
 * PluginSystemState and calls notifyListeners() after state changes.
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

// ── Response type guards ─────────────────────────────────────────────────────

interface InstallResponse {
  ok?: boolean;
  error?: string;
  pluginId?: string;
}

function isInstallResponse(raw: unknown): raw is InstallResponse {
  if (typeof raw !== "object" || raw === null) return false;
  return true;
}

interface UninstallResponse {
  error?: string;
}

function isUninstallResponse(raw: unknown): raw is UninstallResponse {
  return typeof raw === "object" && raw !== null;
}

interface ReinstallResponse {
  ok?: boolean;
  error?: string;
}

function isReinstallResponse(raw: unknown): raw is ReinstallResponse {
  return typeof raw === "object" && raw !== null;
}

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
      const unregister = originalRegisterToolSet(toolSet, slots);
      toolSetUnregisterFns.push(unregister);
      return unregister;
    };

    await Promise.resolve(loadResult.module.activate(host));

    // Plugin-manager gets management methods injected into its bridge.
    if (plugin.id === "plugin-manager") {
      populatePluginManagerBridge(bridge, state, notify);
    }

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
  const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/enable`, {
    method: "POST",
  });
  if (!res.ok) {
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

  const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/disable`, {
    method: "POST",
  });
  if (!res.ok) {
    console.warn(`[pluginSystem] Failed to disable plugin "${pluginId}"`);
  }

  state.allPlugins = await fetchPluginList();
  notify();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Install / Uninstall / Reinstall
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Install a plugin from a user-selected ZIP file.
 */
export async function installPluginFromZip(
  state: PluginSystemState,
  notify: () => void,
): Promise<{ ok: boolean; error?: string }> {
  const file = await pickFileViaInput(".zip");
  if (!file) return { ok: false, error: "No file selected" };

  try {
    const buffer = await file.arrayBuffer();
    const res = await fetch("/api/plugins/install/zip", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer,
    });

    const raw: unknown = await res.json();
    if (!isInstallResponse(raw)) {
      return { ok: false, error: "Invalid response from backend" };
    }

    const ok = raw.ok === true;
    const error = typeof raw.error === "string" ? raw.error : undefined;
    const pluginId = typeof raw.pluginId === "string" ? raw.pluginId : undefined;

    if (ok) {
      await refreshPluginListAndActivate(state, pluginId, notify);
    }

    return { ok, error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Install failed: ${message}` };
  }
}

/**
 * Install a plugin by copying a user-selected folder.
 */
export async function installPluginFromFolder(
  state: PluginSystemState,
  notify: () => void,
): Promise<{ ok: boolean; error?: string }> {
  const folderPath = await pickFolder();
  if (!folderPath) return { ok: false, error: "No folder selected" };

  try {
    const res = await fetch("/api/plugins/install/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderPath }),
    });

    const raw: unknown = await res.json();
    if (!isInstallResponse(raw)) {
      return { ok: false, error: "Invalid response from backend" };
    }

    const ok = raw.ok === true;
    const error = typeof raw.error === "string" ? raw.error : undefined;
    const pluginId = typeof raw.pluginId === "string" ? raw.pluginId : undefined;

    if (ok) {
      await refreshPluginListAndActivate(state, pluginId, notify);
    }

    return { ok, error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Install failed: ${message}` };
  }
}

/**
 * Uninstall a plugin: unregister agent entry → call backend → re-fetch.
 */
export async function uninstallPlugin(
  state: PluginSystemState,
  pluginId: string,
  notify: () => void,
): Promise<{ ok: boolean; error?: string }> {
  const unregister = state.unregisterFns.get(pluginId);
  if (unregister) {
    try { unregister(); } catch (err) {
      console.warn(`[pluginSystem] Error unregistering plugin "${pluginId}":`, err);
    }
    state.unregisterFns.delete(pluginId);
  }

  state.activePlugins = state.activePlugins.filter((p) => p.id !== pluginId);

  const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/uninstall`, {
    method: "POST",
  });
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}));
    if (isUninstallResponse(raw)) {
      return { ok: false, error: raw.error ?? "Uninstall failed" };
    }
    return { ok: false, error: "Uninstall failed" };
  }

  state.allPlugins = await fetchPluginList();
  notify();
  return { ok: true };
}

/**
 * Reinstall a built-in plugin from the pre-compiled release package.
 */
export async function reinstallBuiltInPlugin(
  state: PluginSystemState,
  pluginId: string,
  notify: () => void,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/reinstall`, {
    method: "POST",
  });

  const raw: unknown = await res.json();
  if (!isReinstallResponse(raw)) {
    return { ok: false, error: "Invalid response from backend" };
  }

  const ok = raw.ok === true;
  const error = typeof raw.error === "string" ? raw.error : undefined;

  if (ok) {
    await refreshPluginListAndActivate(state, pluginId, notify);
  }

  return { ok, error };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Bridge population (plugin-manager only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Populate the bridge with plugin management methods for the plugin-manager
 * plugin.  Access control boundary — only plugin-manager gets these.
 */
export function populatePluginManagerBridge(
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

  bridge.installPluginFromZip = async () => {
    return await installPluginFromZip(state, notify);
  };

  bridge.installPluginFromFolder = async () => {
    return await installPluginFromFolder(state, notify);
  };

  bridge.uninstallPlugin = async (pluginId: string) => {
    return await uninstallPlugin(state, pluginId, notify);
  };

  bridge.reinstallBuiltInPlugin = async (pluginId: string) => {
    return await reinstallBuiltInPlugin(state, pluginId, notify);
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Internal helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Re-fetch plugin list from backend and activate the newly installed plugin
 * if it has an agent entry.
 */
async function refreshPluginListAndActivate(
  state: PluginSystemState,
  pluginId: string | undefined,
  notify: () => void,
): Promise<void> {
  const plugins = await fetchPluginList();
  state.allPlugins = plugins;

  if (pluginId && state.agentContext) {
    const installed = plugins.find((p) => p.id === pluginId);
    if (installed && installed.hasAgentEntry && installed.agentEntryUrl) {
      installed.symbols = [];
      await activatePlugin(state, installed, state.agentContext, notify);
    }
  }

  notify();
}

/**
 * Pick a file via a temporary hidden <input type="file"> element.
 */
function pickFileViaInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Pick a folder path using Electron IPC dialog or browser File System Access API.
 */
async function pickFolder(): Promise<string | null> {
  if (window.electronAPI?.invoke) {
    try {
      const apiResult: unknown = await window.electronAPI.invoke("dialog:openDirectory");
      if (isDialogResult(apiResult)) {
        return apiResult.filePaths[0];
      }
      return null;
    } catch {
      // IPC not available — fall through.
    }
  }

  if ("electronAPI" in window && isElectronAPI(window.electronAPI)) {
    try {
      const apiResult: unknown = await window.electronAPI.invoke("dialog:openDirectory");
      if (isDialogResult(apiResult)) {
        return apiResult.filePaths[0];
      }
      return null;
    } catch {
      // IPC not available.
    }
  }

  return prompt("Enter the absolute path to the plugin folder:");
}

// ── Picker type guards ───────────────────────────────────────────────────────

interface DialogResult {
  canceled: boolean;
  filePaths: string[];
}

function isDialogResult(value: unknown): value is DialogResult {
  if (typeof value !== "object" || value === null) return false;
  if (!("canceled" in value) || !("filePaths" in value)) return false;
  return (
    value.canceled === false &&
    Array.isArray(value.filePaths) &&
    typeof value.filePaths[0] === "string"
  );
}

interface ElectronAPIInvoker {
  invoke(channel: string, params?: unknown): Promise<unknown>;
}

function isElectronAPI(value: unknown): value is ElectronAPIInvoker {
  if (typeof value !== "object" || value === null) return false;
  if (!("invoke" in value)) return false;
  return typeof value.invoke === "function";
}
