/**
 * agent-UI/app/appLifecycle.ts — App lifecycle operations
 *
 * Core app runtime operations: activation, enable/disable.
 * Install/uninstall/reinstall are handled by `appManagerApi` in the
 * `agent-UI/appManager/` module — no longer routed through AppBridge.
 *
 * Each function operates on a shared AppSystemState and calls
 * notifyListeners() after state changes.
 *
 * No circular dependencies — this module imports from appState, appTypes,
 * and lower-level app utilities.  The thin factory in appSystem.ts
 * wires everything together.
 */

import type { AppBridge, AppManifest, SlotDeclaration } from "@agent-type";
import { createAppApiClient } from "./apiClient";
import { createAppConfigClient } from "./configClient";
import { loadAppAgentEntry } from "./loader";
import { createAgentAppHost } from "./host";
import { providerStore } from "../store/providerStore";
import type { AgentAppContext } from "./host";
import type { AppDescriptor, AppSystemState } from "./appTypes";
import { fetchAppList } from "./appState";
import { appManagerApi } from "./core/app-manager";

// ═══════════════════════════════════════════════════════════════════════════════
//  Activation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Activate a single app: import agent entry → create host → call activate.
 * Error-isolated (R1): one failure never blocks others.
 */
export async function activateApp(
  state: AppSystemState,
  app: AppDescriptor,
  agentContext: AgentAppContext,
  notify: () => void,
): Promise<void> {
  try {
    const agentEntryUrl = app.agentEntryUrl!;

    const loadResult = await loadAppAgentEntry(app.id, agentEntryUrl);
    if (loadResult.error || !loadResult.module) {
      const errMsg = loadResult.error ?? "Unknown load error";
      console.warn("[appSystem]", errMsg);
      state.appErrors = [
        ...state.appErrors,
        { appId: app.id, appName: app.name, message: errMsg },
      ];
      return;
    }

    const apiClient = createAppApiClient(app.id);

    const manifest: AppManifest = {
      id: app.id,
      name: app.name,
      version: app.version,
      description: app.description,
    };
    const configClient = createAppConfigClient(manifest, apiClient);

    const slotDeclarations = new Map<symbol, readonly SlotDeclaration[]>();
    const bridge: AppBridge = {};
    const toolSetUnregisterFns: Array<() => void> = [];

    const host = createAgentAppHost({
      appId: app.id,
      appName: app.name,
      appVersion: app.version,
      apiClient,
      configClient,
      agentContext,
      bridge,
      attatchToolSets: (toolSet) => {
        const sym = toolSet.symbol ?? Symbol.for(`agent:slot:${app.id}:${toolSet.name}`);
        if (!app.symbols.includes(sym)) {
          app.symbols.push(sym);
        }
      },
      storeSlotDeclarations: (toolSetSymbol, slots) => {
        slotDeclarations.set(toolSetSymbol, slots);
      },
      getSelectedModel: () => providerStore.getSelectedModel(),
    });

    const originalRegisterToolSet = host.registerToolSet;
    host.registerToolSet = (toolSet, slots?) => {
      // ── Inject internal brand for built-in apps ───────────────────
      // This marks every ToolSet from a built-in app as "internal",
      // granting privileged capabilities (e.g. suppressToolSetPrompt).
      // External apps cannot reproduce the symbol, so they never
      // receive these privileges.
      if (app.builtIn && agentContext.internalBrand) {
        (toolSet as Record<symbol, unknown>)[agentContext.internalBrand] = true;
      }

      const unregister = originalRegisterToolSet(toolSet, slots);
      toolSetUnregisterFns.push(unregister);
      return unregister;
    };

    await Promise.resolve(loadResult.module.activate(host));

    if (toolSetUnregisterFns.length > 0) {
      state.unregisterFns.set(app.id, () => {
        for (const fn of toolSetUnregisterFns) {
          try { fn(); } catch (err) {
            console.warn(`[appSystem] Error in unregister for "${app.id}":`, err);
          }
        }
      });
    }

    state.activeApps.push({ host, slotDeclarations, bridge, ...app });
    console.info(
      `[appSystem] Activated app: ${app.id} ("${app.name}") v${app.version}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[appSystem] Failed to activate app "${app.id}":`, errMsg);
    state.appErrors = [
      ...state.appErrors,
      { appId: app.id, appName: app.name, message: errMsg },
    ];
    // R1: failure of one app does not affect others.
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Enable / Disable
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enable a app: call backend enable → re-fetch list → activate agent entry.
 */
export async function enableApp(
  state: AppSystemState,
  appId: string,
  notify: () => void,
): Promise<void> {
  const result = await appManagerApi.enable(appId);
  if (!result.ok) {
    console.warn(`[appSystem] Failed to enable app "${appId}"`);
    return;
  }

  const apps = await fetchAppList();
  state.allApps = apps;

  const app = apps.find((p) => p.id === appId);
  if (!app || !app.hasAgentEntry || !app.agentEntryUrl) {
    notify();
    return;
  }
  if (state.activeApps.some((p) => p.id === appId)) {
    notify();
    return;
  }

  app.symbols = app.symbols ?? [];
  if (state.agentContext) {
    await activateApp(state, app, state.agentContext, notify);
  }

  notify();
}

/**
 * Disable a app: unregister agent entry → call backend → re-fetch list.
 */
export async function disableApp(
  state: AppSystemState,
  appId: string,
  notify: () => void,
): Promise<void> {
  const unregister = state.unregisterFns.get(appId);
  if (unregister) {
    try { unregister(); } catch (err) {
      console.warn(`[appSystem] Error unregistering app "${appId}":`, err);
    }
    state.unregisterFns.delete(appId);
  }

  state.activeApps = state.activeApps.filter((p) => p.id !== appId);

  await appManagerApi.disable(appId);

  state.allApps = await fetchAppList();
  notify();
}
