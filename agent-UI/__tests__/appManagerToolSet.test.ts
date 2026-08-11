/**
 * Tests for agent-UI/app/core/appManagerToolSet.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentAppHost, ToolExecutionContext, SystemPromptContext } from '@agent-type';
import type { AppSystem, AppDescriptor, ActivatedAppInfo } from '../app/appTypes';

const mockCall = vi.hoisted(() => vi.fn());
vi.mock('../app/apiClient', () => ({
  createAppApiClient: () => ({ call: mockCall, connectStream: vi.fn() }),
}));

import { createAppManagerToolSet } from '../app/core/appManagerToolSet';

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

function findTool(toolSet: ReturnType<typeof createAppManagerToolSet>, name: string) {
  const tools = typeof toolSet.tools === 'function' ? toolSet.tools() : toolSet.tools;
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool "${name}" not found`);
  return tool;
}

interface TestAppSystem extends AppSystem {
  setActiveApp(app: ActivatedAppInfo | undefined): void;
}

function makeAppSystem(initialApps: readonly AppDescriptor[]): TestAppSystem {
  let allApps = initialApps;
  let activeApp: ActivatedAppInfo | undefined;
  return {
    init: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    activeApps: [],
    activeSymbols: [],
    get allApps() { return allApps; },
    appErrors: [],
    getApp: (id) => allApps.find((p) => p.id === id),
    getActiveApp: vi.fn(() => activeApp),
    enableApp: vi.fn(async (id: string) => {
      allApps = allApps.map((p) => (p.id === id ? { ...p, state: 'active' } : p));
    }),
    disableApp: vi.fn(async (id: string) => {
      allApps = allApps.map((p) => (p.id === id ? { ...p, state: 'disabled' } : p));
    }),
    refreshAppList: vi.fn(async () => {}),
    activateAppById: vi.fn(async () => {}),
    setActiveApp(app: ActivatedAppInfo | undefined) {
      activeApp = app;
    },
  };
}

const terminalApp: AppDescriptor = {
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

const coreApp: AppDescriptor = {
  id: 'app-manager',
  name: 'App Manager',
  version: '1.0',
  state: 'active',
  builtIn: true,
  canDisable: false,
  hasAgentEntry: false,
  hasUiEntry: true,
  symbols: [],
};

/** Minimal but fully-typed AgentAppHost stub for building an ActivatedAppInfo fixture. */
function fakeHost(appId: string): AgentAppHost {
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
    appId,
    appName: appId,
    appVersion: '1.0',
    getSelectedModel: () => ({ id: 'model', label: 'Model', contextWindow: 0, description: 'Mock model' }),
  };
}

describe('app-manager ToolSet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the expected tool names', () => {
    const toolSet = createAppManagerToolSet(makeAppSystem([]));
    const tools = typeof toolSet.tools === 'function' ? toolSet.tools() : toolSet.tools;
    expect(tools.map((t) => t.name)).toEqual([
      'list_apps',
      'enable_app',
      'disable_app',
      'install_app',
      'uninstall_app',
    ]);
  });

  it('injects a detailed usage guide via onGetSystemPrompt', () => {
    const toolSet = createAppManagerToolSet(makeAppSystem([]));
    expect(toolSet.onGetSystemPrompt).toBeDefined();
    const prompt = toolSet.onGetSystemPrompt?.(
      { sessionId: 's', agentName: 'a', conversationId: 'main' },
      { userMessage: undefined, baseSystemPrompt: undefined, currentSystemPromptParts: [], suppressToolSetPrompt: () => {} },
      [],
    );
    expect(prompt).toContain('list_apps');
    expect(prompt).toContain('enable_app');
    expect(prompt).toContain('uninstall_app');
    expect(prompt).toContain('Built-in apps cannot be uninstalled');
  });

  it('list_apps refreshes and returns plain descriptors', async () => {
    const system = makeAppSystem([terminalApp]);
    const toolSet = createAppManagerToolSet(system);
    const result = await findTool(toolSet, 'list_apps').execute({}, makeCtx());
    expect(system.refreshAppList).toHaveBeenCalled();
    expect(result).toEqual([{
      id: 'terminal', name: 'Terminal', version: '1.0', description: undefined,
      state: 'disabled', builtIn: true, canDisable: true,
    }]);
  });

  it('enable_app enables and reports resulting state', async () => {
    const system = makeAppSystem([terminalApp]);
    const toolSet = createAppManagerToolSet(system);
    const result = await findTool(toolSet, 'enable_app').execute({ appId: 'terminal' }, makeCtx());
    expect(system.enableApp).toHaveBeenCalledWith('terminal');
    expect(result).toEqual({ ok: true, state: 'active' });
  });

  it('enable_app reports not-found', async () => {
    const system = makeAppSystem([]);
    const toolSet = createAppManagerToolSet(system);
    const result = await findTool(toolSet, 'enable_app').execute({ appId: 'ghost' }, makeCtx());
    expect(result).toEqual({ ok: false, error: 'App "ghost" not found' });
  });

  it('disable_app refuses to disable core apps', async () => {
    const system = makeAppSystem([coreApp]);
    const toolSet = createAppManagerToolSet(system);
    const result = await findTool(toolSet, 'disable_app').execute({ appId: 'app-manager' }, makeCtx());
    expect(system.disableApp).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'App "app-manager" cannot be disabled' });
  });

  it('disable_app disables an ordinary app', async () => {
    const active = { ...terminalApp, state: 'active' };
    const system = makeAppSystem([active]);
    const toolSet = createAppManagerToolSet(system);
    const result = await findTool(toolSet, 'disable_app').execute({ appId: 'terminal' }, makeCtx());
    expect(system.disableApp).toHaveBeenCalledWith('terminal');
    expect(result).toEqual({ ok: true });
  });

  it('install_app installs then activates the returned appId', async () => {
    mockCall.mockResolvedValue({ ok: true, appId: 'new-app' });
    const system = makeAppSystem([]);
    const toolSet = createAppManagerToolSet(system);
    const result = await findTool(toolSet, 'install_app').execute({ folderPath: '/tmp/new-app' }, makeCtx());
    expect(mockCall).toHaveBeenCalledWith('installFolder', { path: '/tmp/new-app' });
    expect(system.refreshAppList).toHaveBeenCalled();
    expect(system.activateAppById).toHaveBeenCalledWith('new-app');
    expect(result).toEqual({ ok: true, error: undefined, appId: 'new-app' });
  });

  it('install_app skips activation when install fails', async () => {
    mockCall.mockResolvedValue({ ok: false, error: 'boom' });
    const system = makeAppSystem([]);
    const toolSet = createAppManagerToolSet(system);
    const result = await findTool(toolSet, 'install_app').execute({ folderPath: '/tmp/bad' }, makeCtx());
    expect(system.refreshAppList).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'boom', appId: undefined });
  });

  it('uninstall_app disables an active external app before uninstalling', async () => {
    mockCall.mockResolvedValue({ ok: true });
    const externalApp: AppDescriptor = {
      id: 'community-app', name: 'Community', version: '1.0',
      state: 'active', builtIn: false, canDisable: true,
      hasAgentEntry: true, hasUiEntry: false, symbols: [],
    };
    const system = makeAppSystem([externalApp]);
    system.setActiveApp({ ...externalApp, host: fakeHost('community-app'), slotDeclarations: new Map(), bridge: {} });
    const toolSet = createAppManagerToolSet(system);
    const result = await findTool(toolSet, 'uninstall_app').execute({ appId: 'community-app' }, makeCtx());
    expect(system.disableApp).toHaveBeenCalledWith('community-app');
    expect(mockCall).toHaveBeenCalledWith('uninstall', { appId: 'community-app' });
    expect(system.refreshAppList).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('uninstall_app refuses to uninstall a built-in app', async () => {
    const system = makeAppSystem([terminalApp]);
    const toolSet = createAppManagerToolSet(system);
    const result = await findTool(toolSet, 'uninstall_app').execute({ appId: 'terminal' }, makeCtx());
    expect(mockCall).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'Built-in app "terminal" cannot be uninstalled' });
  });
});
