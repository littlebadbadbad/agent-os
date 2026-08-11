/**
 * agent-UI/app/appState.ts — App system state + fetch helpers
 */

import type { AppDescriptor, AppInfo, AppSystemState } from "./appTypes";
import { toAppDescriptor } from "./appTypes";
import { appManagerApi } from "./core/app-manager";

// ── Safe coercion helpers ────────────────────────────────────────────────────
// Each accessor validates the runtime type individually — no `as` casts.

function pluckString(source: Record<string, unknown>, key: string): string {
  const v = source[key];
  return typeof v === "string" ? v : "";
}

function pluckOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const v = source[key];
  return typeof v === "string" ? v : undefined;
}

function pluckOptionalBool(source: Record<string, unknown>, key: string): boolean | undefined {
  const v = source[key];
  return typeof v === "boolean" ? v : undefined;
}

function pluckBool(source: Record<string, unknown>, key: string): boolean {
  return Boolean(source[key]);
}

function toAppInfo(raw: Record<string, unknown>): AppInfo {
  return {
    id: pluckString(raw, "id"),
    name: pluckString(raw, "name"),
    version: pluckString(raw, "version"),
    description: pluckOptionalString(raw, "description"),
    state: pluckString(raw, "state"),
    builtIn: pluckOptionalBool(raw, "builtIn"),
    canDisable: pluckOptionalBool(raw, "canDisable"),
    hasAgentEntry: pluckBool(raw, "hasAgentEntry"),
    agentEntryUrl: pluckOptionalString(raw, "agentEntryUrl"),
    hasUiEntry: pluckBool(raw, "hasUiEntry"),
    uiEntryUrl: pluckOptionalString(raw, "uiEntryUrl"),
  };
}

// ── State factory ────────────────────────────────────────────────────────────

export function createAppSystemState(): AppSystemState {
  return {
    activeApps: [],
    allApps: [],
    appErrors: [],
    initialized: false,
    listeners: new Set(),
    unregisterFns: new Map(),
    agentContext: null,
  };
}

// ── Notify all listeners ─────────────────────────────────────────────────────

export function notifyListeners(state: AppSystemState): void {
  for (const cb of state.listeners) {
    cb();
  }
}

// ── Fetch apps from backend ───────────────────────────────────────────────

/**
 * Fetch the full app list from the backend via the app-manager core API.
 * Runtime shape validation — no type assertions, no `as` casts.
 */
export async function fetchAppList(): Promise<AppDescriptor[]> {
  try {
    const rawApps = await appManagerApi.list();
    const apps: AppDescriptor[] = [];
    for (const item of rawApps) {
      const record = coerceRecord(item);
      if (record) {
        apps.push(toAppDescriptor(toAppInfo(record)));
      }
    }
    return apps;
  } catch (err) {
    console.warn("[appSystem] Error fetching app list:", err);
    return [];
  }
}

/**
 * Coerce a known-object value to a clean Record for safe property access.
 * Creates a fresh object with null prototype — no type assertions.
 */
function coerceRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.assign(Object.create(null), value);
  }
  return undefined;
}
