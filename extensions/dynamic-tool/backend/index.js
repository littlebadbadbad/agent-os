/**
 * extensions/dynamic-tool/backend/index.js — Dynamic tool backend plugin
 *
 * Registers all dynamic-tool API methods via host.defineApi().
 * Uses host.getPluginDataDir() to obtain the data directory.
 */

import { createToolStore } from './lib/store.js';
import { createModuleStore } from './lib/moduleStore.js';
import { createDepStore } from './lib/depStore.js';
import { createToolEnv } from './lib/toolEnv.js';
import { createToolServices } from './services/tools.js';

export function activate(host) {
  const dataDir = host.getPluginDataDir();
  const toolEnv = createToolEnv(dataDir);
  const toolStore = createToolStore(dataDir, toolEnv);
  const moduleStore = createModuleStore(dataDir, toolEnv);
  const depStore = createDepStore(toolEnv);
  const svc = createToolServices({ toolStore, moduleStore, depStore });

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
