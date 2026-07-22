/**
 * agent-UI/plugin/pluginBuiltIn.ts — Compile-time built-in plugin registry
 *
 * Single source of truth (baked into the bundle at build time by Vite)
 * for which plugins are built-in.  Same data source as
 * backend/lib/plugin-scanner.js — both read built-in-plugins.json.
 */

import builtInPluginData from "../../built-in-plugins.json";

/** Set of plugin IDs that are built-in. */
const BUILT_IN_PLUGIN_IDS: ReadonlySet<string> = new Set(
  builtInPluginData.plugins ?? [],
);

/**
 * Check whether a plugin ID corresponds to a built-in plugin.
 * Compile-time check — no network dependency.
 */
export function isBuiltInPlugin(id: string): boolean {
  return BUILT_IN_PLUGIN_IDS.has(id);
}
