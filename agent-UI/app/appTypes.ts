/**
 * agent-UI/app/appTypes.ts — Shared types for the app lifecycle system
 */

import type {
  AgentAppHost,
  AppBridge,
  SlotDeclaration,
} from "@agent-type";
import { AgentAppContext } from "./host";

// ── Re-export AgentAppContext for convenience ─────────────────────────────
export type { AgentAppContext } from "./host";

// ── Public types ─────────────────────────────────────────────────────────────

export interface AppDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly state: string;
  readonly builtIn?: boolean;
  readonly canDisable?: boolean;
  readonly hasAgentEntry: boolean;
  readonly agentEntryUrl?: string;
  readonly hasUiEntry: boolean;
  readonly uiEntryUrl?: string;
  symbols: symbol[];
}

/**
 * App info as received from the backend API response.
 * `symbols` is absent because Symbol cannot be serialized over HTTP.
 * This is the canonical source type — app/core/app-manager.ts
 * imports and re-exports it so the API layer and lifecycle layer
 * share a single definition.
 */
export interface AppInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly state: string;
  readonly builtIn?: boolean;
  readonly canDisable?: boolean;
  readonly hasAgentEntry: boolean;
  readonly agentEntryUrl?: string;
  readonly hasUiEntry: boolean;
  readonly uiEntryUrl?: string;
}

/** Map an API response descriptor to a full AppDescriptor. */
export function toAppDescriptor(api: AppInfo): AppDescriptor {
  return { ...api, symbols: [] };
}

export interface AppSystem {
  init(agentContext: AgentAppContext): Promise<void>;
  subscribe(cb: () => void): () => void;
  readonly activeApps: readonly ActivatedAppInfo[];
  readonly activeSymbols: readonly symbol[];
  readonly allApps: readonly AppDescriptor[];
  readonly appErrors: readonly AppLoadError[];
  getApp(appId: string): AppDescriptor | undefined;
  getActiveApp(appId: string): ActivatedAppInfo | undefined;
  enableApp(appId: string): Promise<void>;
  disableApp(appId: string): Promise<void>;
  refreshAppList(): Promise<void>;
  activateAppById(appId: string): Promise<void>;
}

export interface ActivatedAppInfo extends AppDescriptor {
  readonly host: AgentAppHost;
  readonly slotDeclarations: Map<symbol, readonly SlotDeclaration[]>;
  readonly bridge: AppBridge;
}

export interface AppLoadError {
  readonly appId: string;
  readonly appName: string;
  readonly message: string;
}

// ── Internal state ───────────────────────────────────────────────────────────

export interface AppSystemState {
  activeApps: ActivatedAppInfo[];
  allApps: AppDescriptor[];
  appErrors: AppLoadError[];
  initialized: boolean;
  listeners: Set<() => void>;
  unregisterFns: Map<string, () => void>;
  agentContext: AgentAppContext | null;
}
