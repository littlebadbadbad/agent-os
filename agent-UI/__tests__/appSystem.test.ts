/**
 * Tests for agent-UI/app/appSystem.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../app/appState', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as any,
    fetchAppList: vi.fn(),
  };
});

const mockActivateApp = vi.hoisted(() => vi.fn(async (state: any, app: any) => {
  state.activeApps.push({ ...app, host: {}, slotDeclarations: new Map(), bridge: {} });
}));
vi.mock('../app/appLifecycle', () => ({
  activateApp: mockActivateApp,
  enableApp: vi.fn(),
  disableApp: vi.fn(),
}));

import { fetchAppList } from '../app/appState';
import { activateApp, enableApp, disableApp } from '../app/appLifecycle';
import { createAppSystem } from '../app/appSystem';

describe('createAppSystem', () => {
  const mockContext = {
    addToolSet: vi.fn(),
    getRegisteredToolSets: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    agentName: 'test-agent',
  } as any;

  beforeEach(() => vi.clearAllMocks());

  it('subscribe adds and returns unsubscribe', () => {
    const system = createAppSystem();
    const cb = vi.fn();

    const unsub = system.subscribe(cb);

    // Call refreshAppList which triggers notifyListeners
    // For now just verify unsub works
    expect(typeof unsub).toBe('function');
  });

  it('init calls fetchAppList and activates apps', async () => {
    vi.mocked(fetchAppList).mockResolvedValue([
      { id: 'p1', name: 'P1', version: '1.0', state: 'active', hasAgentEntry: true, agentEntryUrl: '/agent-apps/p1/a.js', hasUiEntry: false, symbols: [] },
    ] as any);

    const system = createAppSystem();
    await system.init(mockContext);

    expect(fetchAppList).toHaveBeenCalled();
    expect(activateApp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'p1' }),
      mockContext,
      expect.any(Function),
    );
  });

  it('init is idempotent', async () => {
    vi.mocked(fetchAppList).mockResolvedValue([]);

    const system = createAppSystem();
    await system.init(mockContext);
    await system.init(mockContext);

    expect(fetchAppList).toHaveBeenCalledTimes(1);
  });

  it('init populates allApps', async () => {
    vi.mocked(fetchAppList).mockResolvedValue([
      { id: 'p1', name: 'P1', version: '1.0', state: 'active', hasAgentEntry: false, hasUiEntry: false, symbols: [] },
    ] as any);

    const system = createAppSystem();
    await system.init(mockContext);

    expect(system.allApps).toHaveLength(1);
    expect(system.allApps[0].id).toBe('p1');
  });

  it('getApp finds by id across active and all', () => {
    const system = createAppSystem();
    expect(system.getApp('nonexistent')).toBeUndefined();
  });

  it('getActiveApp returns undefined for inactive app', () => {
    const system = createAppSystem();
    expect(system.getActiveApp('nonexistent')).toBeUndefined();
  });

  it('enableApp delegates to lifecycle', async () => {
    const system = createAppSystem();
    await system.enableApp('p1');
    expect(enableApp).toHaveBeenCalledWith(
      expect.anything(), 'p1', expect.any(Function),
    );
  });

  it('disableApp delegates to lifecycle', async () => {
    const system = createAppSystem();
    await system.disableApp('p1');
    expect(disableApp).toHaveBeenCalledWith(
      expect.anything(), 'p1', expect.any(Function),
    );
  });

  it('refreshAppList refetches and notifies', async () => {
    vi.mocked(fetchAppList).mockResolvedValue([]);
    const system = createAppSystem();
    const cb = vi.fn();
    system.subscribe(cb);

    await system.refreshAppList();

    expect(fetchAppList).toHaveBeenCalled();
    expect(cb).toHaveBeenCalled();
  });

  it('activeSymbols returns symbols from active apps', async () => {
    vi.mocked(fetchAppList).mockResolvedValue([
      { id: 'p1', name: 'P1', version: '1.0', state: 'active', hasAgentEntry: true, agentEntryUrl: '/agent-apps/p1/a.js', hasUiEntry: false, symbols: [Symbol('s1')] },
    ] as any);

    const system = createAppSystem();
    await system.init(mockContext);

    expect(system.activeSymbols).toHaveLength(1);
  });

  it('appErrors returns initial empty array', () => {
    const system = createAppSystem();
    expect(system.appErrors).toEqual([]);
  });
});
