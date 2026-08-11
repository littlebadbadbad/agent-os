/**
 * internal-apps/dynamic-tool/backend/index.js — Dynamic tool backend app
 *
 * Registers all dynamic-tool API methods via host.defineApi().
 * Uses host.getAppDataDir() to obtain the data directory.
 * Command execution goes through the terminal app's cross-app service.
 */

import { createToolStore } from './lib/store.js';
import { createModuleStore } from './lib/moduleStore.js';
import { createDepStore } from './lib/depStore.js';
import { createToolEnv } from './lib/toolEnv.js';
import { createProxyRequest } from './lib/proxyRequest.js';
import { createToolServices } from './services/tools.js';

/** @import { BackendAppHost } from '@agent-type/app.ts' */

/**
 * Activate the dynamic-tool app backend.
 *
 * Resolves the terminal cross-app service for command execution (pnpm).
 * Throws if the terminal app is not available.
 *
 * @param {BackendAppHost} host
 */
export function activate(host) {
  const terminal = host.services.resolve('terminal');
  if (!terminal) {
    throw new Error('[dynamic-tool] Cannot activate: terminal service not available. Ensure the terminal app is enabled.');
  }

  const dataDir = host.getAppDataDir();
  const toolEnv = createToolEnv(dataDir);
  const toolStore = createToolStore(dataDir, toolEnv);
  const moduleStore = createModuleStore(dataDir, toolEnv);
  const depStore = createDepStore(toolEnv, terminal);
  const proxyRequest = createProxyRequest(() => host.getBackendConfig('proxy'));
  const svc = createToolServices({ toolStore, moduleStore, depStore, proxyRequest });

  host.defineApi('listTools', async () => svc.getToolsList());
  host.defineApi('createTool', async (params) => svc.createTool(params));
  host.defineApi('updateTool', async (params) => svc.updateTool({ name: params.name, patch: params }));
  host.defineApi('deleteTool', async (params) => svc.deleteTool(params));
  host.defineApi('executeTool', async (params) => svc.runTool({
    name: params.name,
    args: params.arguments,
    ctx: { sessionId: params.sessionId, agentName: params.agentName, conversationId: params.conversationId },
  }));
  host.defineApi('listModules', async () => svc.getModulesList());
  host.defineApi('getModule', async (params) => svc.getToolModule(params));
  host.defineApi('createModule', async (params) => svc.createToolModule(params));
  host.defineApi('updateModule', async (params) => svc.updateToolModule({ name: params.name, patch: params }));
  host.defineApi('deleteModule', async (params) => svc.deleteToolModule(params));
  host.defineApi('listDeps', async () => svc.getDepsList());
  host.defineApi('installDeps', async (params) => svc.installToolDeps(params));
  host.defineApi('removeDep', async (params) => svc.removeToolDep({ pkg: params.package }));
}
