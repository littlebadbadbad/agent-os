/**
 * Tests for agent-UI/plugin/pluginState.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../plugin/core/plugin-manager', () => ({
  pluginManagerApi: {
    list: vi.fn(),
  },
}));

import { pluginManagerApi } from '../plugin/core/plugin-manager';
import { createPluginSystemState, notifyListeners, fetchPluginList } from '../plugin/pluginState';

describe('pluginState', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createPluginSystemState', () => {
    it('creates initial state with empty arrays and default values', () => {
      const state = createPluginSystemState();

      expect(state.activePlugins).toEqual([]);
      expect(state.allPlugins).toEqual([]);
      expect(state.pluginErrors).toEqual([]);
      expect(state.initialized).toBe(false);
      expect(state.listeners).toBeInstanceOf(Set);
      expect(state.unregisterFns).toBeInstanceOf(Map);
      expect(state.agentContext).toBeNull();
    });
  });

  describe('notifyListeners', () => {
    it('calls all registered listeners', () => {
      const state = createPluginSystemState();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      state.listeners.add(cb1);
      state.listeners.add(cb2);

      notifyListeners(state);

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });

  describe('fetchPluginList', () => {
    it('returns empty array on API error', async () => {
      vi.mocked(pluginManagerApi.list).mockRejectedValue(new Error('API down'));
      const result = await fetchPluginList();
      expect(result).toEqual([]);
    });

    it('returns plugins from backend', async () => {
      vi.mocked(pluginManagerApi.list).mockResolvedValue([
        { id: 'p1', name: 'Plugin 1', version: '1.0', state: 'active', hasAgentEntry: true, hasUiEntry: false },
        { id: 'p2', name: 'Plugin 2', version: '2.0', state: 'disabled', hasAgentEntry: false, hasUiEntry: true },
      ] as any);

      const result = await fetchPluginList();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('p1');
      expect(result[0].symbols).toEqual([]);
      expect(result[1].id).toBe('p2');
    });
  });
});
