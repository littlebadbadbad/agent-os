/**
 * agent-UI/app/appSystem.ts — App lifecycle coordinator (thin factory)
 *
 * Orchestrates the full lifecycle of frontend apps by delegating to
 * focused sub-modules:
 *
 *   appTypes.ts       — All type definitions
 *   appBuiltIn.ts     — Compile-time built-in app registry
 *   appState.ts       — State management and backend fetch helpers
 *   appLifecycle.ts   — App activation and enable/disable
 *
 * This module is the public API surface — createAppSystem() creates a
 * AppSystem instance that consumers interact with.  Types are re-exported
 * for convenience to minimise import path changes.
 *
 * Usage:
 *   const system = createAppSystem();
 *   await system.init({ addToolSet, getTools, agentName });
 */

import type { AgentAppContext } from "./host";
import type {
  ActivatedAppInfo,
  AppDescriptor,
  AppLoadError,
  AppSystem,
} from "./appTypes";
import { createAppSystemState, fetchAppList, notifyListeners } from "./appState";
import {
  activateApp,
  disableApp,
  enableApp,
} from "./appLifecycle";

// ── Re-exports for backward compatibility ────────────────────────────────────

export type { AppSystem, AppDescriptor, ActivatedAppInfo, AppLoadError } from "./appTypes";

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAppSystem(): AppSystem {
  const state = createAppSystemState();

  return {
    subscribe(cb: () => void): () => void {
      state.listeners.add(cb);
      return () => { state.listeners.delete(cb); };
    },

    async init(agentContext: AgentAppContext): Promise<void> {
      if (state.initialized) return;
      state.initialized = true;
      state.agentContext = agentContext;

      const apps = await fetchAppList();
      state.allApps = apps;

      const agentApps = apps.filter(
        (p) => p.hasAgentEntry && p.agentEntryUrl,
      );

      for (const app of agentApps) {
        app.symbols = app.symbols ?? [];
        await activateApp(state, app, agentContext, () => notifyListeners(state));
      }

      notifyListeners(state);
    },

    get activeSymbols(): readonly symbol[] {
      return state.activeApps.flatMap((p) => p.symbols);
    },

    get activeApps(): readonly ActivatedAppInfo[] {
      return state.activeApps;
    },

    get allApps(): readonly AppDescriptor[] {
      return state.allApps;
    },

    get appErrors(): readonly AppLoadError[] {
      return state.appErrors;
    },

    getApp(appId: string): AppDescriptor | undefined {
      const active = state.activeApps.find((p) => p.id === appId);
      if (active) return active;
      return state.allApps.find((p) => p.id === appId);
    },

    getActiveApp(appId: string): ActivatedAppInfo | undefined {
      return state.activeApps.find((p) => p.id === appId);
    },

    async enableApp(appId: string): Promise<void> {
      await enableApp(state, appId, () => notifyListeners(state));
    },

    async disableApp(appId: string): Promise<void> {
      await disableApp(state, appId, () => notifyListeners(state));
    },

    async refreshAppList(): Promise<void> {
      const apps = await fetchAppList();
      state.allApps = apps;
      notifyListeners(state);
    },

    async activateAppById(appId: string): Promise<void> {
      const app = state.allApps.find((p) => p.id === appId);
      if (!app || !app.hasAgentEntry || !app.agentEntryUrl) return;
      if (state.activeApps.some((p) => p.id === appId)) return;
      if (!state.agentContext) return;

      app.symbols = app.symbols ?? [];
      await activateApp(state, app, state.agentContext, () => notifyListeners(state));
      notifyListeners(state);
    },
  };
}
