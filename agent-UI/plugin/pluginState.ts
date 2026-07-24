/**
 * agent-UI/plugin/pluginState.ts — Plugin system state + fetch helpers
 */

import type { PluginDescriptor, PluginInfo, PluginSystemState } from "./pluginTypes";
import { toPluginDescriptor } from "./pluginTypes";
import { pluginManagerApi } from "./core/plugin-manager";

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

function toPluginInfo(raw: Record<string, unknown>): PluginInfo {
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

export function createPluginSystemState(): PluginSystemState {
  return {
    activePlugins: [],
    allPlugins: [],
    pluginErrors: [],
    initialized: false,
    listeners: new Set(),
    unregisterFns: new Map(),
    agentContext: null,
  };
}

// ── Notify all listeners ─────────────────────────────────────────────────────

export function notifyListeners(state: PluginSystemState): void {
  for (const cb of state.listeners) {
    cb();
  }
}

// ── Fetch plugins from backend ───────────────────────────────────────────────

/**
 * Fetch the full plugin list from the backend via the plugin-manager core API.
 * Runtime shape validation — no type assertions, no `as` casts.
 */
export async function fetchPluginList(): Promise<PluginDescriptor[]> {
  try {
    const rawPlugins = await pluginManagerApi.list();
    const plugins: PluginDescriptor[] = [];
    for (const item of rawPlugins) {
      const record = coerceRecord(item);
      if (record) {
        plugins.push(toPluginDescriptor(toPluginInfo(record)));
      }
    }
    return plugins;
  } catch (err) {
    console.warn("[pluginSystem] Error fetching plugin list:", err);
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
