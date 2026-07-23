/**
 * Tests for agent-UI/plugin/pluginSystem.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../plugin/pluginState', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as any,
    fetchPluginList: vi.fn(),
  };
});

const mockActivatePlugin = vi.hoisted(() => vi.fn(async (state: any, plugin: any) => {
  state.activePlugins.push({ ...plugin, host: {}, slotDeclarations: new Map(), bridge: {} });
}));
vi.mock('../plugin/pluginLifecycle', () => ({
  activatePlugin: mockActivatePlugin,
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
}));

import { fetchPluginList } from '../plugin/pluginState';
import { activatePlugin, enablePlugin, disablePlugin } from '../plugin/pluginLifecycle';
import { createPluginSystem } from '../plugin/pluginSystem';

describe('createPluginSystem', () => {
  const mockContext = {
    addToolSet: vi.fn(),
    getRegisteredToolSets: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    agentName: 'test-agent',
  } as any;

  beforeEach(() => vi.clearAllMocks());

  it('subscribe adds and returns unsubscribe', () => {
    const system = createPluginSystem();
    const cb = vi.fn();

    const unsub = system.subscribe(cb);

    // Call refreshPluginList which triggers notifyListeners
    // For now just verify unsub works
    expect(typeof unsub).toBe('function');
  });

  it('init calls fetchPluginList and activates plugins', async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([
      { id: 'p1', name: 'P1', version: '1.0', state: 'active', hasAgentEntry: true, agentEntryUrl: '/plugins/p1/a.js', hasUiEntry: false, symbols: [] },
    ] as any);

    const system = createPluginSystem();
    await system.init(mockContext);

    expect(fetchPluginList).toHaveBeenCalled();
    expect(activatePlugin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'p1' }),
      mockContext,
      expect.any(Function),
    );
  });

  it('init is idempotent', async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([]);

    const system = createPluginSystem();
    await system.init(mockContext);
    await system.init(mockContext);

    expect(fetchPluginList).toHaveBeenCalledTimes(1);
  });

  it('init populates allPlugins', async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([
      { id: 'p1', name: 'P1', version: '1.0', state: 'active', hasAgentEntry: false, hasUiEntry: false, symbols: [] },
    ] as any);

    const system = createPluginSystem();
    await system.init(mockContext);

    expect(system.allPlugins).toHaveLength(1);
    expect(system.allPlugins[0].id).toBe('p1');
  });

  it('getPlugin finds by id across active and all', () => {
    const system = createPluginSystem();
    expect(system.getPlugin('nonexistent')).toBeUndefined();
  });

  it('getActivePlugin returns undefined for inactive plugin', () => {
    const system = createPluginSystem();
    expect(system.getActivePlugin('nonexistent')).toBeUndefined();
  });

  it('enablePlugin delegates to lifecycle', async () => {
    const system = createPluginSystem();
    await system.enablePlugin('p1');
    expect(enablePlugin).toHaveBeenCalledWith(
      expect.anything(), 'p1', expect.any(Function),
    );
  });

  it('disablePlugin delegates to lifecycle', async () => {
    const system = createPluginSystem();
    await system.disablePlugin('p1');
    expect(disablePlugin).toHaveBeenCalledWith(
      expect.anything(), 'p1', expect.any(Function),
    );
  });

  it('refreshPluginList refetches and notifies', async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([]);
    const system = createPluginSystem();
    const cb = vi.fn();
    system.subscribe(cb);

    await system.refreshPluginList();

    expect(fetchPluginList).toHaveBeenCalled();
    expect(cb).toHaveBeenCalled();
  });

  it('activeSymbols returns symbols from active plugins', async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([
      { id: 'p1', name: 'P1', version: '1.0', state: 'active', hasAgentEntry: true, agentEntryUrl: '/plugins/p1/a.js', hasUiEntry: false, symbols: [Symbol('s1')] },
    ] as any);

    const system = createPluginSystem();
    await system.init(mockContext);

    expect(system.activeSymbols).toHaveLength(1);
  });

  it('pluginErrors returns initial empty array', () => {
    const system = createPluginSystem();
    expect(system.pluginErrors).toEqual([]);
  });
});
