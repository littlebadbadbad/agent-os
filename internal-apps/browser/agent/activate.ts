/**
 * internal-apps/browser/agent/activate.ts — Browser app activation entry
 *
 * This is the app's agent-side entry point, loaded by the app runtime
 * when the browser extension is activated.
 *
 * The app receives an AgentAppHost with a pre-bound apiClient
 * (no appId parameter needed) and registers its ToolSet.
 *
 * No classes — pure factory function pattern.
 */

import type { AgentAppHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createBrowserAppAdapter } from './appAdapter';
import { createBrowserToolSet, getBrowserSlotDeclarations } from './toolSet';

/**
 * Activate the browser app.
 *
 * Creates a app adapter backed by the pre-bound apiClient, builds
 * the browser ToolSet, and registers it on the agent.
 *
 * @param host  The AgentAppHost for this app.
 */
export function activate(host: AgentAppHost): void {
  // Create a BrowserAdapter that talks to the backend via host.apiClient.
  // The apiClient is pre-bound to 'browser' — no appId needed.
  const adapter = createBrowserAppAdapter(host.apiClient);

  // Build the browser ToolSet using this adapter.
  const toolSet = createBrowserToolSet(adapter);
  const slots = getBrowserSlotDeclarations(resolveToolSetTools(toolSet).map((t) => t.name));

  // Register the ToolSet and its slot declarations on the agent.
  host.registerToolSet(toolSet, slots);
}
