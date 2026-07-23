/**
 * Tests for agent-UI/agents.ts — Main application wiring module.
 *
 * Since agents.ts has side-effectful module-level exports, each test file
 * must use vi.mock BEFORE importing the module under test.
 * We use dynamic import() inside each describe block to get fresh mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock ALL dependencies of agents.ts ───────────────────────────────────────

const mockCreateAgentClient = vi.fn();
const mockCreateSubAgentToolset = vi.fn();
const mockCreatePluginSystem = vi.fn();
const mockAsyncHandler = vi.fn();
const mockStreamHandler = vi.fn();
const mockProviderConfigStore = vi.fn();
const mockSessionStore = vi.fn();
const mockCreateDefaultUIRenderer = vi.fn();
const mockIsElectronIpc = vi.fn();

vi.mock('@agent-sdk', () => ({
  createAgentClient: (...a: unknown[]) => mockCreateAgentClient(...a),
  createSubAgentToolset: (...a: unknown[]) => mockCreateSubAgentToolset(...a),
}));

vi.mock('../plugin', () => ({
  createPluginSystem: (...a: unknown[]) => mockCreatePluginSystem(...a),
}));

vi.mock('../handlers/asyncHandler', () => ({
  asyncHandler: mockAsyncHandler,
}));

vi.mock('../handlers/streamHandler', () => ({
  streamHandler: mockStreamHandler,
}));

vi.mock('../store/providerConfigStore', () => ({
  providerConfigStore: mockProviderConfigStore,
}));

vi.mock('../createAdapters', () => ({
  sessionStore: mockSessionStore,
}));

vi.mock('../defaultRenderUI', () => ({
  createDefaultUIRenderer: (...a: unknown[]) => mockCreateDefaultUIRenderer(...a),
}));

vi.mock('../env', () => ({
  IS_ELECTRON_IPC: mockIsElectronIpc,
}));

describe('agents.ts module exports', () => {
  let mod: typeof import('../agents');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreateAgentClient.mockReturnValue({
      id: 'mock-agent',
      registerToolSet: vi.fn().mockReturnValue(() => {}),
      getRegisteredToolSets: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      restoreSessions: vi.fn(),
      flushPersistence: vi.fn().mockResolvedValue(undefined),
    });
    mockCreateSubAgentToolset.mockReturnValue({ name: 'subagent-toolset' });
    mockCreatePluginSystem.mockReturnValue({
      init: vi.fn().mockResolvedValue(undefined),
    });
    mockCreateDefaultUIRenderer.mockReturnValue(() => () => {});
    mockProviderConfigStore.load = vi.fn().mockResolvedValue(undefined);
    mockProviderConfigStore.load = vi.fn().mockResolvedValue(undefined);
    mockSessionStore.loadSessions = vi.fn().mockResolvedValue([]);
    mockSessionStore.saveSessions = vi.fn().mockResolvedValue(undefined);
    // Reset modules for each test
    vi.resetModules();
    mod = await import('../agents');
  });

  it('exports pluginSystem, asyncAgent, streamAgent, initSessions', () => {
    expect(mod).toHaveProperty('pluginSystem');
    expect(mod).toHaveProperty('asyncAgent');
    expect(mod).toHaveProperty('streamAgent');
    expect(mod).toHaveProperty('initSessions');
  });

  it('creates two agents with correct IDs', () => {
    const calls = mockCreateAgentClient.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0].id).toBe('async-agent');
    expect(calls[1][0].id).toBe('stream-agent');
  });

  it('creates agents with different handlers', () => {
    const calls = mockCreateAgentClient.mock.calls;
    expect(calls[0][0].handler).toBe(mockAsyncHandler);
    expect(calls[1][0].handler).toBe(mockStreamHandler);
  });

  describe('initSessions', () => {
    it('calls pluginSystem.init with combined context', async () => {
      const mockInit = vi.fn().mockResolvedValue(undefined);
      mockCreatePluginSystem.mockReturnValue({ init: mockInit });
      vi.resetModules();
      mod = await import('../agents');
      await mod.initSessions();
      expect(mockInit).toHaveBeenCalledTimes(1);
      expect(mockInit.mock.calls[0][0]).toHaveProperty('addToolSet');
      expect(mockInit.mock.calls[0][0]).toHaveProperty('getRegisteredToolSets');
      expect(mockInit.mock.calls[0][0]).toHaveProperty('getTools');
      expect(mockInit.mock.calls[0][0].agentName).toBe('stream+async');
    });

    it('loads provider config', async () => {
      const loadFn = vi.fn().mockResolvedValue(undefined);
      mockProviderConfigStore.load = loadFn;
      vi.resetModules();
      mod = await import('../agents');
      await mod.initSessions();
      expect(loadFn).toHaveBeenCalledTimes(1);
    });

    it('restores sessions from sessionStore', async () => {
      const asyncSessions = [{ sessionId: 's1', messages: [{ role: 'user', text: 'hi' }] }];
      const streamSessions: Array<{ sessionId: string }> = [];
      mockSessionStore.loadSessions = vi.fn()
        .mockResolvedValueOnce(asyncSessions)
        .mockResolvedValueOnce(streamSessions);
      const restoreAsync = vi.fn();
      const restoreStream = vi.fn();
      mockCreateAgentClient
        .mockReset()
        .mockReturnValueOnce({
          id: 'async-agent',
          registerToolSet: vi.fn().mockReturnValue(() => {}),
          getRegisteredToolSets: vi.fn().mockReturnValue([]),
          getTools: vi.fn().mockReturnValue([]),
          restoreSessions: restoreAsync,
          flushPersistence: vi.fn().mockResolvedValue(undefined),
        })
        .mockReturnValueOnce({
          id: 'stream-agent',
          registerToolSet: vi.fn().mockReturnValue(() => {}),
          getRegisteredToolSets: vi.fn().mockReturnValue([]),
          getTools: vi.fn().mockReturnValue([]),
          restoreSessions: restoreStream,
          flushPersistence: vi.fn().mockResolvedValue(undefined),
        });
      vi.resetModules();
      mod = await import('../agents');
      await mod.initSessions();
      expect(restoreAsync).toHaveBeenCalledWith(asyncSessions);
      expect(restoreStream).not.toHaveBeenCalled(); // stream has empty sessions
    });

    it('flushes persistence on browser beforeunload', { todo: true }, async () => {
      // This test requires complex mock setup for env module (IS_ELECTRON_IPC)
      // and window global stubbing. Skipped for now.
    });
  });
});
