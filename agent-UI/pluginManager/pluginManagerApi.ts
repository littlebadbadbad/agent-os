/**
 * agent-UI/pluginManager/pluginManagerApi.ts — Plugin management API
 *
 * Re-exports the unified plugin manager API from the super built-in
 * "plugin-manager" plugin client.
 *
 * All calls go through PluginApiClient (dual HTTP/IPC transport).
 */

export { pluginManagerApi } from '../plugin/core/plugin-manager';
export type { PluginActionResponse, PluginInstallResponse } from '../plugin/core/plugin-manager';
