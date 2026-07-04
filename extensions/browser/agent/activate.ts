/**
 * extensions/browser/agent/activate.ts — Browser plugin activation entry
 *
 * This is the plugin's agent-side entry point, loaded by the plugin runtime
 * when the browser extension is activated.
 *
 * The plugin receives an AgentPluginHost with a pre-bound apiClient
 * (no pluginId parameter needed) and registers its ToolSet.
 *
 * No classes — pure factory function pattern.
 */

import type { AgentPluginHost } from '@agent-type';
import { createBrowserPluginAdapter } from './pluginAdapter';
import { createBrowserToolSet } from './toolSet';

/**
 * Activate the browser plugin.
 *
 * Creates a plugin adapter backed by the pre-bound apiClient, builds
 * the browser ToolSet, and registers it on the agent.
 *
 * @param host  The AgentPluginHost for this plugin.
 */
export function activate(host: AgentPluginHost): void {
  // Create a BrowserAdapter that talks to the backend via host.apiClient.
  // The apiClient is pre-bound to 'browser' — no pluginId needed.
  const adapter = createBrowserPluginAdapter(host.apiClient);

  // Build the browser ToolSet using this adapter.
  const toolSet = createBrowserToolSet(adapter);

  // Register the ToolSet on the agent.
  host.registerToolSet(toolSet);
}
