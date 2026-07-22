/**
 * agent-UI/plugin/index.ts — Plugin runtime barrel export
 *
 * Re-exports all public types and factories from the plugin runtime.
 * Consumers import from this module, never from individual files.
 *
 * Usage:
 *   import { createPluginSystem } from '../plugin';
 *   const system = createPluginSystem();
 *   await system.init(agentContext);
 */

export { createPluginApiClient } from './apiClient';
export type { PluginApiClientOptions, PluginApiError } from './apiClient';

export { createPluginConfigClient } from './configClient';
export type { PluginConfigClient } from './configClient';

export { loadPluginAgentEntry } from './loader';
export type { PluginAgentModule, PluginLoadResult } from './loader';

export { createAgentPluginHost } from './host';
export type { AgentPluginContext, AgentPluginHostParams } from './host';

export { createPluginSystem } from './pluginSystem';
export type { PluginSystem, PluginDescriptor, ActivatedPluginInfo, PluginLoadError } from './pluginTypes';

export { createUiPluginHost } from './uiHost';
export type { UiPluginHostParams } from './uiHost';
