/**
 * Tests for agent-UI/plugin/core/plugin-manager.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCall = vi.hoisted(() => vi.fn());
const mockConnectStream = vi.hoisted(() => vi.fn());
vi.mock('../plugin/apiClient', () => ({
  createPluginApiClient: () => ({ call: mockCall, connectStream: mockConnectStream }),
}));

import { pluginManagerApi } from '../plugin/core/plugin-manager';

describe('plugin-manager core API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list returns plugins', async () => {
    mockCall.mockResolvedValue({ plugins: [{ id: 'p1', name: 'P1', version: '1.0', state: 'active' }] });
    const result = await pluginManagerApi.list();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('list returns empty on error', async () => {
    mockCall.mockRejectedValue(new Error('err'));
    const result = await pluginManagerApi.list();
    expect(result).toEqual([]);
  });

  it('list returns empty for unexpected response', async () => {
    mockCall.mockResolvedValue({ not: 'plugins' });
    const result = await pluginManagerApi.list();
    expect(result).toEqual([]);
  });

  it('getConfig returns plugin config', async () => {
    mockCall.mockResolvedValue({ key: 'val' });
    const result = await pluginManagerApi.getConfig('p1');
    expect(result).toEqual({ key: 'val' });
    expect(mockCall).toHaveBeenCalledWith('getConfig', { pluginId: 'p1' });
  });

  it('saveConfig calls plugin-manager.saveConfig', async () => {
    mockCall.mockResolvedValue(undefined);
    await pluginManagerApi.saveConfig('p1', { enabled: true });
    expect(mockCall).toHaveBeenCalledWith('saveConfig', { pluginId: 'p1', config: { enabled: true } });
  });

  it('enable returns ok', async () => {
    mockCall.mockResolvedValue({ ok: true });
    const result = await pluginManagerApi.enable('p1');
    expect(result.ok).toBe(true);
  });

  it('enable handles error', async () => {
    mockCall.mockRejectedValue(new Error('fail'));
    const result = await pluginManagerApi.enable('p1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('fail');
  });

  it('disable returns ok', async () => {
    mockCall.mockResolvedValue({ ok: true });
    const result = await pluginManagerApi.disable('p1');
    expect(result.ok).toBe(true);
  });

  it('uninstall returns ok', async () => {
    mockCall.mockResolvedValue({ ok: true });
    const result = await pluginManagerApi.uninstall('p1');
    expect(result.ok).toBe(true);
  });
});
