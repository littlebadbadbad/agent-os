/**
 * agent-UI/plugin/pluginState.ts — Plugin system state + fetch helpers
 */

import type { PluginDescriptor, PluginSystemState } from "./pluginTypes";
import type { PluginApiDescriptor } from "./pluginTypes";
import { toPluginDescriptor } from "./pluginTypes";

// ── Type guard ───────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPluginListBody(value: unknown): value is { plugins?: unknown[] } {
  if (!isRecord(value)) return false;
  return !("plugins" in value) || Array.isArray(value.plugins);
}

// ── Safe coercion helpers ────────────────────────────────────────────────────

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toApiDescriptor(raw: Record<string, unknown>): PluginApiDescriptor {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    version: String(raw.version ?? ""),
    description: str(raw.description),
    state: String(raw.state ?? ""),
    builtIn: bool(raw.builtIn),
    canDisable: bool(raw.canDisable),
    hasAgentEntry: Boolean(raw.hasAgentEntry),
    agentEntryUrl: str(raw.agentEntryUrl),
    hasUiEntry: Boolean(raw.hasUiEntry),
    uiEntryUrl: str(raw.uiEntryUrl),
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
 * Fetch the full plugin list from the backend /api/plugins endpoint.
 * Runtime shape validation — no type assertions.
 */
export async function fetchPluginList(): Promise<PluginDescriptor[]> {
  try {
    const res = await fetch("/api/plugins");
    if (!res.ok) {
      console.warn("[pluginSystem] Failed to fetch plugin list:", res.status);
      return [];
    }

    const raw: unknown = await res.json();
    if (!isPluginListBody(raw)) {
      console.warn("[pluginSystem] Invalid plugin list response");
      return [];
    }

    const rawPlugins = raw.plugins ?? [];
    const plugins: PluginDescriptor[] = [];

    for (const item of rawPlugins) {
      if (isRecord(item)) {
        plugins.push(toPluginDescriptor(toApiDescriptor(item)));
      }
    }

    return plugins;
  } catch (err) {
    console.warn("[pluginSystem] Error fetching plugin list:", err);
    return [];
  }
}
