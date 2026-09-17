/**
 * Shared tool metadata helpers.
 *
 * Small, dependency-free module so `globalStore`, `toolSet`, `bridge` and
 * `manageTools` can agree on the same facts (resident tool names,
 * description resolution) without importing each other.
 */

import type { Tool } from '@agent-type';

/** Resolve a tool description that may be a static string or a getter. */
export function resolveDescription(tool: Tool): string {
  const desc = tool.description;
  return typeof desc === 'function' ? desc() : desc;
}

/**
 * Tools that are ALWAYS enabled and can never be turned off — neither by a
 * session (panel / `manage_tools`) nor by the global (toolButton) control.
 *
 * `manage_tools` must stay reachable, otherwise the AI could disable its own
 * way back in and the session would be stuck with no tools at all.
 */
export const RESIDENT_TOOLS: ReadonlySet<string> = new Set(['manage_tools']);

/** Whether a tool name is resident (always enabled, never disableable). */
export function isResident(name: string): boolean {
  return RESIDENT_TOOLS.has(name);
}
