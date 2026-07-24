/**
 * agent-UI/plugin/core/index.ts — Core plugin API barrel
 *
 * Aggregates and re-exports all super built-in plugin API wrappers.
 * Consumers import from this module instead of directly using apiTransport.
 *
 * Each domain creates a pre-bound PluginApiClient that routes calls
 * through the shared dual-transport (HTTP/IPC) mechanism.
 */

export {
  fetchPublicKey,
  checkHealth,
} from './system';
export type { PublicKeyInfo } from './system';

export {
  getProxyConfig,
  updateProxyConfig,
  testProxyTarget,
} from './proxy';
export type { ProxyConfig, ProxyInfo, ProxyTestResult } from './proxy';

export {
  listModels,
} from './models';
export type { ModelInfo } from './models';

export {
  fetchMergedModelConfig,
  fetchBuiltInModelConfig,
  fetchCustomModelConfig,
  saveCustomModelConfig,
  addCustomModelProvider,
  removeCustomModelProvider,
  updateCustomModelProvider,
} from './model-config';

export {
  loadSessions,
  saveSessions,
} from './sessions';

export {
  pluginManagerApi,
} from './plugin-manager';
export type {
  PluginActionResponse,
  PluginInstallResponse,
} from './plugin-manager';

export {
  sendAsync,
  sendStream,
} from './chat';
export type { ChatParams } from './chat';
