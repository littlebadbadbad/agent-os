/**
 * Tests for backend/services/proxy.js — Proxy configuration service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetProxyConfig = vi.fn();
const mockSetProxyConfig = vi.fn();
const mockTestProxy = vi.fn();
const mockValidateProxyUpdate = vi.fn();
const mockValidateTestTarget = vi.fn();

vi.mock('../lib/proxy.js', () => ({
  getProxyConfig: mockGetProxyConfig,
  setProxyConfig: mockSetProxyConfig,
  testProxy: mockTestProxy,
  validateProxyUpdate: mockValidateProxyUpdate,
  validateTestTarget: mockValidateTestTarget,
}));

describe('proxy service', () => {
  let proxy;

  beforeEach(async () => {
    vi.resetModules();
    proxy = await import('../services/proxy.js');
  });

  it('getConfig returns proxy config', () => {
    mockGetProxyConfig.mockReturnValue({ enabled: true, host: 'localhost', port: 7890 });
    const cfg = proxy.getConfig();
    expect(cfg.enabled).toBe(true);
    expect(mockGetProxyConfig).toHaveBeenCalled();
  });

  it('updateConfig validates and updates', () => {
    mockValidateProxyUpdate.mockReturnValue({ enabled: true });
    mockSetProxyConfig.mockReturnValue({ enabled: true, host: 'localhost', port: 7890 });
    const result = proxy.updateConfig({ enabled: true });
    expect(result.config).toBeDefined();
    expect(mockValidateProxyUpdate).toHaveBeenCalledWith({ enabled: true });
  });

  it('testProxyTarget validates target and tests', async () => {
    mockValidateTestTarget.mockReturnValue(undefined);
    mockTestProxy.mockResolvedValue({ ok: true, ms: 42 });
    const result = await proxy.testProxyTarget('https://example.com');
    expect(result.ok).toBe(true);
    expect(mockValidateTestTarget).toHaveBeenCalledWith('https://example.com');
  });
});
