/**
 * Tests for agent-UI/agents.ts — Main application wiring module.
 *
 * The production app mounts a SINGLE agent (streamAgent).  The async
 * handler exists only as a reference example and is deliberately not
 * wired here — see handlers/asyncHandler.ts.
 *
 * Since agents.ts has side-effectful module-level exports, each test file
 * must use vi.mock BEFORE importing the module under test.
 * We use dynamic import() inside each describe block to get fresh mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock ALL dependencies of agents.ts ───────────────────────────────────────

const mockCreateAgentClient = vi.fn();
const mockCreateSubAgentToolset = vi.fn();
const mockCreateAppSystem = vi.fn();
const mockStreamHandler = vi.fn();
const mockProviderConfigStore: { load: ReturnType<typeof vi.fn> } = { load: vi.fn() };
const mockSessionStore: { loadSessions: ReturnType<typeof vi.fn>; saveSessions: ReturnType<typeof vi.fn> } = { loadSessions: vi.fn(), saveSessions: vi.fn() };
const mockCreateDefaultUIRenderer = vi.fn();
// IS_ELECTRON_IPC is a boolean constant — a truthy mock (e.g. a vi.fn()) would
// route createAppApiClient into the IPC branch and crash on `window` in node.
const mockIsElectronIpc = false;

vi.mock('@agent-sdk', () => ({
  createAgentClient: (...a: unknown[]) => mockCreateAgentClient(...a),
  createSubAgentToolset: (...a: unknown[]) => mockCreateSubAgentToolset(...a),
}));

vi.mock('../app', () => ({
  createAppSystem: (...a: unknown[]) => mockCreateAppSystem(...a),
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
      id: 'stream-agent',
      registerToolSet: vi.fn().mockReturnValue(() => {}),
      getRegisteredToolSets: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      restoreSessions: vi.fn(),
      flushPersistence: vi.fn().mockResolvedValue(undefined),
    });
    mockCreateSubAgentToolset.mockReturnValue({ name: 'subagent-toolset' });
    mockCreateAppSystem.mockReturnValue({
      init: vi.fn().mockResolvedValue(undefined),
    });
    mockCreateDefaultUIRenderer.mockReturnValue(() => () => {});
    mockProviderConfigStore.load = vi.fn().mockResolvedValue(undefined);
    mockSessionStore.loadSessions = vi.fn().mockResolvedValue([]);
    mockSessionStore.saveSessions = vi.fn().mockResolvedValue(undefined);
    // Reset modules for each test
    vi.resetModules();
    mod = await import('../agents');
  });

  it('exports appSystem, streamAgent, initSessions', () => {
    expect(mod).toHaveProperty('appSystem');
    expect(mod).toHaveProperty('streamAgent');
    expect(mod).toHaveProperty('initSessions');
    // The async agent is a reference example only — never mounted.
    expect(mod).not.toHaveProperty('asyncAgent');
  });

  it('creates a single agent with the stream id', () => {
    const calls = mockCreateAgentClient.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0].id).toBe('stream-agent');
  });

  it('creates the agent with the stream handler', () => {
    const calls = mockCreateAgentClient.mock.calls;
    expect(calls[0][0].handler).toBe(mockStreamHandler);
  });

  describe('initSessions', () => {
    it('calls appSystem.init with a context bound to streamAgent', async () => {
      const mockInit = vi.fn().mockResolvedValue(undefined);
      mockCreateAppSystem.mockReturnValue({ init: mockInit });
      vi.resetModules();
      mod = await import('../agents');
      await mod.initSessions();
      expect(mockInit).toHaveBeenCalledTimes(1);
      expect(mockInit.mock.calls[0][0]).toHaveProperty('addToolSet');
      expect(mockInit.mock.calls[0][0]).toHaveProperty('getRegisteredToolSets');
      expect(mockInit.mock.calls[0][0]).toHaveProperty('getTools');
      expect(mockInit.mock.calls[0][0].agentName).toBe('stream-agent');
    });

    it('loads provider config', async () => {
      const loadFn = vi.fn().mockResolvedValue(undefined);
      mockProviderConfigStore.load = loadFn as ReturnType<typeof vi.fn>;
      vi.resetModules();
      mod = await import('../agents');
      await mod.initSessions();
      expect(loadFn).toHaveBeenCalledTimes(1);
    });

    it('restores sessions from sessionStore', async () => {
      const streamSessions = [{ sessionId: 's1', messages: [{ role: 'user', text: 'hi' }] }];
      mockSessionStore.loadSessions = vi.fn().mockResolvedValue(streamSessions);
      const restoreStream = vi.fn();
      mockCreateAgentClient
        .mockReset()
        .mockReturnValue({
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
      expect(mockSessionStore.loadSessions).toHaveBeenCalledWith('stream-agent');
      expect(restoreStream).toHaveBeenCalledWith(streamSessions);
    });

    it('flushes persistence on browser beforeunload', { todo: true }, async () => {
      // This test requires complex mock setup for env module (IS_ELECTRON_IPC)
      // and window global stubbing. Skipped for now.
    });
  });
});
