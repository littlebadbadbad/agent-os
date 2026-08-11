/**
 * agent-UI/app/appBuiltIn.ts — Compile-time built-in app registry
 *
 * Single source of truth (baked into the bundle at build time by Vite)
 * for which apps are built-in.  Same data source as
 * backend/lib/app-scanner.js — both read built-in-apps.json.
 */

import builtInAppData from "../../built-in-apps.json";

/** Set of app IDs that are built-in. */
const BUILT_IN_APP_IDS: ReadonlySet<string> = new Set(
  builtInAppData.apps ?? [],
);

/**
 * Check whether a app ID corresponds to a built-in app.
 * Compile-time check — no network dependency.
 */
export function isBuiltInApp(id: string): boolean {
  return BUILT_IN_APP_IDS.has(id);
}
