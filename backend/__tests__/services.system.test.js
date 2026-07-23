/**
 * Tests for backend/services/system.js — System service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/rsa.js', () => ({
  getPublicKeyPem: vi.fn(() => '-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----'),
}));

describe('system service', () => {
  let system;

  beforeEach(async () => {
    vi.resetModules();
    system = await import('../services/system.js');
  });

  it('checkHealth returns ok', () => {
    expect(system.checkHealth()).toEqual({ status: 'ok' });
  });

  it('getPublicKeyInfo returns public key', () => {
    const info = system.getPublicKeyInfo();
    expect(info.publicKey).toContain('PUBLIC KEY');
  });

  it('getAppVersion returns version from package.json', () => {
    const ver = system.getAppVersion();
    expect(ver).toHaveProperty('version');
  });
});
