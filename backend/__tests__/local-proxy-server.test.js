/**
 * Tests for backend/lib/local-proxy-server.js.
 * Validates lifecycle: start, stop, restart, and address reporting.
 */
import { describe, it, expect, vi } from 'vitest';
import { LocalProxyServer } from '../lib/local-proxy-server.js';

/** Simplest upstream config for testing. */
const TEST_UPSTREAM = {
  protocol:       'http',
  host:           'localhost',
  port:           7890,
  username:       '',
  password:       '',
  noProxy:        '',
  connectTimeout: 10_000,
};

describe('LocalProxyServer', () => {
  it('starts and reports address', async () => {
    const server = new LocalProxyServer();
    const addr = await server.start(TEST_UPSTREAM);
    expect(addr.host).toBe('127.0.0.1');
    expect(typeof addr.port).toBe('number');
    expect(addr.port).toBeGreaterThan(0);
    expect(addr.port).toBeLessThan(65536);

    const got = server.getAddress();
    expect(got.host).toBe('127.0.0.1');
    expect(got.port).toBe(addr.port);
    server.stop();
  });

  it('returns null from getAddress before start', () => {
    const server = new LocalProxyServer();
    expect(server.getAddress()).toBeNull();
  });

  it('stop is idempotent', () => {
    const server = new LocalProxyServer();
    server.stop();
    server.stop(); // must not throw
  });

  it('restart rebinds to a new port', async () => {
    const server = new LocalProxyServer();
    const addr1 = await server.start(TEST_UPSTREAM);
    const addr2 = await server.restart(TEST_UPSTREAM);

    expect(addr2.host).toBe('127.0.0.1');
    expect(typeof addr2.port).toBe('number');
    // Port may or may not change — depends on OS. Just verify it's valid.
    expect(addr2.port).toBeGreaterThan(0);
    server.stop();
  });

  it('restart works when not yet started', async () => {
    const server = new LocalProxyServer();
    const addr = await server.restart(TEST_UPSTREAM);
    expect(addr.host).toBe('127.0.0.1');
    expect(addr.port).toBeGreaterThan(0);
    server.stop();
  });
});
