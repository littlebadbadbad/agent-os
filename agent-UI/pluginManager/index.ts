/**
 * agent-UI/pluginManager/index.ts — Plugin Manager barrel export
 *
 * Exports the plugin manager API and native React component.
 * Consumers import from this module, never from individual files.
 *
 * The API layer is now a re-export of the super built-in "plugin-manager"
 * core plugin client (agent-UI/plugin/core/plugin-manager.ts).
 *
 * Usage:
 *   import { pluginManagerApi, PluginManagerPanel } from '../pluginManager';
 */

export { pluginManagerApi } from '../plugin/core/plugin-manager';
export type { PluginInfo } from '../plugin/pluginTypes';

export { PluginManagerPanel } from './PluginManagerPanel';
export type { PluginManagerPanelProps } from './PluginManagerPanel';
