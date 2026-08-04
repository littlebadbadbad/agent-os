/**
 * Tests for agent-UI/plugin/core/pluginManagerToolSet.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentPluginHost, ToolExecutionContext, SystemPromptContext } from '@agent-type';
import type { PluginSystem, PluginDescriptor, ActivatedPluginInfo } from '../plugin/pluginTypes';

const mockCall = vi.hoisted(() => vi.fn());
vi.mock('../plugin/apiClient', () => ({
  createPluginApiClient: () => ({ call: mockCall, connectStream: vi.fn() }),
}));

import { createPluginManagerToolSet } from '../plugin/core/pluginManagerToolSet';

function makeCtx(): ToolExecutionContext {
  return {
    signal: new AbortController().signal,
    sessionId: 'session-1',
    agentName: 'main',
    conversationId: 'session-1',
    sourceAgent: 'main',
    isSubAgent: false,
  };
}

const PROMPT_CTX: SystemPromptContext = {
  userMessage: undefined,
  baseSystemPrompt: undefined,
  currentSystemPromptParts: [],
  suppressToolSetPrompt: () => {},
};

function findTool(toolSet: ReturnType<typeof createPluginManagerToolSet>, name: string) {
  const tools = typeof toolSet.tools === 'function' ? toolSet.tools() : toolSet.tools;
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool "${name}" not found`);
  return tool;
}

interface TestPluginSystem extends PluginSystem {
  setActivePlugin(plugin: ActivatedPluginInfo | undefined): void;
}

function makePluginSystem(initialPlugins: readonly PluginDescriptor[]): TestPluginSystem {
  let allPlugins = initialPlugins;
  let activePlugin: ActivatedPluginInfo | undefined;
  return {
    init: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    activePlugins: [],
    activeSymbols: [],
    get allPlugins() { return allPlugins; },
    pluginErrors: [],
    getPlugin: (id) => allPlugins.find((p) => p.id === id),
    getActivePlugin: vi.fn(() => activePlugin),
    enablePlugin: vi.fn(async (id: string) => {
      allPlugins = allPlugins.map((p) => (p.id === id ? { ...p, state: 'active' } : p));
    }),
    disablePlugin: vi.fn(async (id: string) => {
      allPlugins = allPlugins.map((p) => (p.id === id ? { ...p, state: 'disabled' } : p));
    }),
    refreshPluginList: vi.fn(async () => {}),
    activatePluginById: vi.fn(async () => {}),
    setActivePlugin(plugin: ActivatedPluginInfo | undefined) {
      activePlugin = plugin;
    },
  };
}

const terminalPlugin: PluginDescriptor = {
  id: 'terminal',
  name: 'Terminal',
  version: '1.0',
  state: 'disabled',
  builtIn: true,
  canDisable: true,
  hasAgentEntry: true,
  hasUiEntry: true,
  symbols: [],
};

const corePlugin: PluginDescriptor = {
  id: 'plugin-manager',
  name: 'Plugin Manager',
  version: '1.0',
  state: 'active',
  builtIn: true,
  canDisable: false,
  hasAgentEntry: false,
  hasUiEntry: true,
  symbols: [],
};

/** Minimal but fully-typed AgentPluginHost stub for building an ActivatedPluginInfo fixture. */
function fakeHost(pluginId: string): AgentPluginHost {
  return {
    registerToolSet: () => () => {},
    bridge: {},
    getRegisteredToolSets: () => [],
    getTools: () => [],
    agentName: 'main',
    apiClient: {
      call: async <T>(): Promise<T> => ({} as T),
      connectStream: () => ({
        callbacks: { onData: () => {}, onEnd: () => {}, onError: () => {} },
        subscribe: () => ({ unsubscribe: () => {} }),
      }),
    },
    getConfig: () => { throw new Error('not implemented'); },
    onConfigChanged: () => () => {},
    pluginId,
    pluginName: pluginId,
    pluginVersion: '1.0',
    getSelectedModel: () => ({ id: 'model', label: 'Model', contextWindow: 0, description: 'Mock model' }),
  };
}

describe('plugin-manager ToolSet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the expected tool names', () => {
    const toolSet = createPluginManagerToolSet(makePluginSystem([]));
    const tools = typeof toolSet.tools === 'function' ? toolSet.tools() : toolSet.tools;
    expect(tools.map((t) => t.name)).toEqual([
      'list_plugins',
      'enable_plugin',
      'disable_plugin',
      'install_plugin',
      'uninstall_plugin',
    ]);
  });

  it('injects a detailed usage guide via onGetSystemPrompt', () => {
    const toolSet = createPluginManagerToolSet(makePluginSystem([]));
    expect(toolSet.onGetSystemPrompt).toBeDefined();
    const prompt = toolSet.onGetSystemPrompt?.(
      { sessionId: 's', agentName: 'a', conversationId: 'main' },
      { userMessage: undefined, baseSystemPrompt: undefined, currentSystemPromptParts: [], suppressToolSetPrompt: () => {} },
      [],
    );
    expect(prompt).toContain('list_plugins');
    expect(prompt).toContain('enable_plugin');
    expect(prompt).toContain('uninstall_plugin');
    expect(prompt).toContain('Built-in plugins cannot be uninstalled');
  });

  it('list_plugins refreshes and returns plain descriptors', async () => {
    const system = makePluginSystem([terminalPlugin]);
    const toolSet = createPluginManagerToolSet(system);
    const result = await findTool(toolSet, 'list_plugins').execute({}, makeCtx());
    expect(system.refreshPluginList).toHaveBeenCalled();
    expect(result).toEqual([{
      id: 'terminal', name: 'Terminal', version: '1.0', description: undefined,
      state: 'disabled', builtIn: true, canDisable: true,
    }]);
  });

  it('enable_plugin enables and reports resulting state', async () => {
    const system = makePluginSystem([terminalPlugin]);
    const toolSet = createPluginManagerToolSet(system);
    const result = await findTool(toolSet, 'enable_plugin').execute({ pluginId: 'terminal' }, makeCtx());
    expect(system.enablePlugin).toHaveBeenCalledWith('terminal');
    expect(result).toEqual({ ok: true, state: 'active' });
  });

  it('enable_plugin reports not-found', async () => {
    const system = makePluginSystem([]);
    const toolSet = createPluginManagerToolSet(system);
    const result = await findTool(toolSet, 'enable_plugin').execute({ pluginId: 'ghost' }, makeCtx());
    expect(result).toEqual({ ok: false, error: 'Plugin "ghost" not found' });
  });

  it('disable_plugin refuses to disable core plugins', async () => {
    const system = makePluginSystem([corePlugin]);
    const toolSet = createPluginManagerToolSet(system);
    const result = await findTool(toolSet, 'disable_plugin').execute({ pluginId: 'plugin-manager' }, makeCtx());
    expect(system.disablePlugin).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'Plugin "plugin-manager" cannot be disabled' });
  });

  it('disable_plugin disables an ordinary plugin', async () => {
    const active = { ...terminalPlugin, state: 'active' };
    const system = makePluginSystem([active]);
    const toolSet = createPluginManagerToolSet(system);
    const result = await findTool(toolSet, 'disable_plugin').execute({ pluginId: 'terminal' }, makeCtx());
    expect(system.disablePlugin).toHaveBeenCalledWith('terminal');
    expect(result).toEqual({ ok: true });
  });

  it('install_plugin installs then activates the returned pluginId', async () => {
    mockCall.mockResolvedValue({ ok: true, pluginId: 'new-plugin' });
    const system = makePluginSystem([]);
    const toolSet = createPluginManagerToolSet(system);
    const result = await findTool(toolSet, 'install_plugin').execute({ folderPath: '/tmp/new-plugin' }, makeCtx());
    expect(mockCall).toHaveBeenCalledWith('installFolder', { path: '/tmp/new-plugin' });
    expect(system.refreshPluginList).toHaveBeenCalled();
    expect(system.activatePluginById).toHaveBeenCalledWith('new-plugin');
    expect(result).toEqual({ ok: true, error: undefined, pluginId: 'new-plugin' });
  });

  it('install_plugin skips activation when install fails', async () => {
    mockCall.mockResolvedValue({ ok: false, error: 'boom' });
    const system = makePluginSystem([]);
    const toolSet = createPluginManagerToolSet(system);
    const result = await findTool(toolSet, 'install_plugin').execute({ folderPath: '/tmp/bad' }, makeCtx());
    expect(system.refreshPluginList).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'boom', pluginId: undefined });
  });

  it('uninstall_plugin disables an active external plugin before uninstalling', async () => {
    mockCall.mockResolvedValue({ ok: true });
    const externalPlugin: PluginDescriptor = {
      id: 'community-plugin', name: 'Community', version: '1.0',
      state: 'active', builtIn: false, canDisable: true,
      hasAgentEntry: true, hasUiEntry: false, symbols: [],
    };
    const system = makePluginSystem([externalPlugin]);
    system.setActivePlugin({ ...externalPlugin, host: fakeHost('community-plugin'), slotDeclarations: new Map(), bridge: {} });
    const toolSet = createPluginManagerToolSet(system);
    const result = await findTool(toolSet, 'uninstall_plugin').execute({ pluginId: 'community-plugin' }, makeCtx());
    expect(system.disablePlugin).toHaveBeenCalledWith('community-plugin');
    expect(mockCall).toHaveBeenCalledWith('uninstall', { pluginId: 'community-plugin' });
    expect(system.refreshPluginList).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('uninstall_plugin refuses to uninstall a built-in plugin', async () => {
    const system = makePluginSystem([terminalPlugin]);
    const toolSet = createPluginManagerToolSet(system);
    const result = await findTool(toolSet, 'uninstall_plugin').execute({ pluginId: 'terminal' }, makeCtx());
    expect(mockCall).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'Built-in plugin "terminal" cannot be uninstalled' });
  });
});
