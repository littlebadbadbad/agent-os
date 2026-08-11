/**
 * Tests for agent-UI/app/core/app-manager.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCall = vi.hoisted(() => vi.fn());
const mockConnectStream = vi.hoisted(() => vi.fn());
vi.mock('../app/apiClient', () => ({
  createAppApiClient: () => ({ call: mockCall, connectStream: mockConnectStream }),
}));

import { appManagerApi } from '../app/core/app-manager';

describe('app-manager core API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list returns apps', async () => {
    mockCall.mockResolvedValue({ apps: [{ id: 'p1', name: 'P1', version: '1.0', state: 'active' }] });
    const result = await appManagerApi.list();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('list returns empty on error', async () => {
    mockCall.mockRejectedValue(new Error('err'));
    const result = await appManagerApi.list();
    expect(result).toEqual([]);
  });

  it('list returns empty for unexpected response', async () => {
    mockCall.mockResolvedValue({ not: 'apps' });
    const result = await appManagerApi.list();
    expect(result).toEqual([]);
  });

  it('getConfig returns app config', async () => {
    mockCall.mockResolvedValue({ key: 'val' });
    const result = await appManagerApi.getConfig('p1');
    expect(result).toEqual({ key: 'val' });
    expect(mockCall).toHaveBeenCalledWith('getConfig', { appId: 'p1' });
  });

  it('saveConfig calls app-manager.saveConfig', async () => {
    mockCall.mockResolvedValue(undefined);
    await appManagerApi.saveConfig('p1', { enabled: true });
    expect(mockCall).toHaveBeenCalledWith('saveConfig', { appId: 'p1', config: { enabled: true } });
  });

  it('enable returns ok', async () => {
    mockCall.mockResolvedValue({ ok: true });
    const result = await appManagerApi.enable('p1');
    expect(result.ok).toBe(true);
  });

  it('enable handles error', async () => {
    mockCall.mockRejectedValue(new Error('fail'));
    const result = await appManagerApi.enable('p1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('fail');
  });

  it('disable returns ok', async () => {
    mockCall.mockResolvedValue({ ok: true });
    const result = await appManagerApi.disable('p1');
    expect(result.ok).toBe(true);
  });

  it('uninstall returns ok', async () => {
    mockCall.mockResolvedValue({ ok: true });
    const result = await appManagerApi.uninstall('p1');
    expect(result.ok).toBe(true);
  });
});
