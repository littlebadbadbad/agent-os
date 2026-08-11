/**
 * Tests for agent-UI/app/appState.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../app/core/app-manager', () => ({
  appManagerApi: {
    list: vi.fn(),
  },
}));

import { appManagerApi } from '../app/core/app-manager';
import { createAppSystemState, notifyListeners, fetchAppList } from '../app/appState';

describe('appState', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createAppSystemState', () => {
    it('creates initial state with empty arrays and default values', () => {
      const state = createAppSystemState();

      expect(state.activeApps).toEqual([]);
      expect(state.allApps).toEqual([]);
      expect(state.appErrors).toEqual([]);
      expect(state.initialized).toBe(false);
      expect(state.listeners).toBeInstanceOf(Set);
      expect(state.unregisterFns).toBeInstanceOf(Map);
      expect(state.agentContext).toBeNull();
    });
  });

  describe('notifyListeners', () => {
    it('calls all registered listeners', () => {
      const state = createAppSystemState();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      state.listeners.add(cb1);
      state.listeners.add(cb2);

      notifyListeners(state);

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });

  describe('fetchAppList', () => {
    it('returns empty array on API error', async () => {
      vi.mocked(appManagerApi.list).mockRejectedValue(new Error('API down'));
      const result = await fetchAppList();
      expect(result).toEqual([]);
    });

    it('returns apps from backend', async () => {
      vi.mocked(appManagerApi.list).mockResolvedValue([
        { id: 'p1', name: 'App 1', version: '1.0', state: 'active', hasAgentEntry: true, hasUiEntry: false },
        { id: 'p2', name: 'App 2', version: '2.0', state: 'disabled', hasAgentEntry: false, hasUiEntry: true },
      ] as any);

      const result = await fetchAppList();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('p1');
      expect(result[0].symbols).toEqual([]);
      expect(result[1].id).toBe('p2');
    });
  });
});
