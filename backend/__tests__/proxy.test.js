/**
 * Comprehensive edge-case tests for backend/lib/proxy.js.
 * Tests: validation helpers, createProxyFetch, get/set/config, testProxy, env var init.
 */
import { describe, it, expect, vi } from 'vitest';

// ── Local proxy server mock — self-contained, uses a class for `new` compatibility ─
const MOCK_LOCAL_PORT = 12345;

vi.mock('undici', () => {
  const mockFetch = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
  return {
    ProxyAgent: vi.fn(),
    Agent: vi.fn(),
    fetch: mockFetch,
  };
});

vi.mock('../lib/local-proxy-server.js', () => {
  class MockLocalProxy {
    constructor() {
      this._addr = { host: '127.0.0.1', port: MOCK_LOCAL_PORT };
    }
    getAddress() { return this._addr; }
    start()  { return Promise.resolve(this._addr); }
    restart() { return Promise.resolve(this._addr); }
    stop() {}
  }
  return { LocalProxyServer: MockLocalProxy };
});

async function loadProxy() {
  vi.resetModules();
  delete process.env.HTTPS_PROXY; delete process.env.https_proxy;
  delete process.env.HTTP_PROXY; delete process.env.http_proxy;
  delete process.env.ALL_PROXY; delete process.env.all_proxy;
  return await import('../lib/proxy.js');
}

describe('proxy constants', () => {
  it('VALID_PROTOCOLS', async () => {
    const p = await loadProxy();
    expect(p.VALID_PROTOCOLS).toEqual(['http','https','socks5','socks4']);
  });
  it('ALLOWED_FIELDS', async () => {
    const p = await loadProxy();
    for (const f of ['protocol','host','port','username','password','noProxy','connectTimeout'])
      expect(p.ALLOWED_FIELDS).toContain(f);
  });
  it('PASSWORD_MASK', async () => {
    const p = await loadProxy();
    expect(p.PASSWORD_MASK).toBe('••••••');
  });
  it('createProxyFetch returns function', async () => {
    const p = await loadProxy();
    const proxyFetch = p.createProxyFetch();
    expect(typeof proxyFetch).toBe('function');
  });
});

describe('proxy validateProxyUpdate', () => {
  it('rejects port 0', async () => {
    const p = await loadProxy();
    expect(() => p.validateProxyUpdate({ port: 0 })).toThrow();
  });
  it('rejects port > 65535', async () => {
    const p = await loadProxy();
    expect(() => p.validateProxyUpdate({ port: 70000 })).toThrow();
  });
  it('rejects non-integer port', async () => {
    const p = await loadProxy();
    expect(() => p.validateProxyUpdate({ port: 'abc' })).toThrow();
  });
  it('rejects decimal port', async () => {
    const p = await loadProxy();
    expect(() => p.validateProxyUpdate({ port: 12.5 })).toThrow();
  });
  it('rejects invalid protocol', async () => {
    const p = await loadProxy();
    expect(() => p.validateProxyUpdate({ protocol: 'ftp' })).toThrow();
  });
  it('rejects empty host', async () => {
    const p = await loadProxy();
    expect(() => p.validateProxyUpdate({ host: '' })).toThrow();
  });
  it('rejects null host', async () => {
    const p = await loadProxy();
    expect(() => p.validateProxyUpdate({ host: null })).toThrow();
  });
  it('trims host whitespace', async () => {
    const p = await loadProxy();
    expect(p.validateProxyUpdate({ host: '  x  ' }).host).toBe('x');
  });
  it('rejects connectTimeout < 500', async () => {
    const p = await loadProxy();
    expect(() => p.validateProxyUpdate({ connectTimeout: 100 })).toThrow();
  });
  it('accepts connectTimeout = 500', async () => {
    const p = await loadProxy();
    expect(p.validateProxyUpdate({ connectTimeout: 500 }).connectTimeout).toBe(500);
  });
  it('rejects connectTimeout Infinity', async () => {
    const p = await loadProxy();
    expect(() => p.validateProxyUpdate({ connectTimeout: Infinity })).toThrow();
  });
  it('ignores unknown fields', async () => {
    const p = await loadProxy();
    const r = p.validateProxyUpdate({ bogus: 'x', host: 'valid' });
    expect(r).not.toHaveProperty('bogus');
    expect(r.host).toBe('valid');
  });
});

describe('proxy validateTestTarget', () => {
  it('accepts http', async () => {
    const p = await loadProxy();
    expect(p.validateTestTarget('http://example.com')).toBe('http://example.com');
  });
  it('accepts https', async () => {
    const p = await loadProxy();
    expect(p.validateTestTarget('https://api.test.com')).toBe('https://api.test.com');
  });
  it('rejects non-string', async () => {
    const p = await loadProxy();
    expect(() => p.validateTestTarget(42)).toThrow();
  });
  it('rejects invalid URL', async () => {
    const p = await loadProxy();
    expect(() => p.validateTestTarget('not-a-url')).toThrow();
  });
  it('rejects ftp (SSRF)', async () => {
    const p = await loadProxy();
    expect(() => p.validateTestTarget('ftp://example.com')).toThrow();
  });
  it('rejects file protocol', async () => {
    const p = await loadProxy();
    expect(() => p.validateTestTarget('file:///etc/passwd')).toThrow();
  });
});

describe('proxy config operations', () => {
  it('getProxyConfig returns local address with empty auth', async () => {
    const p = await loadProxy();
    const cfg = p.getProxyConfig();
    expect(cfg.protocol).toBe('http');
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(12345);
    expect(cfg.username).toBe('');
    expect(cfg.password).toBe('');
  });
  it('getUpstreamConfig returns upstream config with masked password', async () => {
    const p = await loadProxy();
    p.setProxyConfig({ host: 'upstream.example.com', port: 8080, password: 'secret' });
    const cfg = p.getUpstreamConfig();
    expect(cfg.host).toBe('upstream.example.com');
    expect(cfg.port).toBe(8080);
    expect(cfg.password).toBe(p.PASSWORD_MASK);
  });
  it('setProxyConfig updates upstream and restarts local proxy', async () => {
    const p = await loadProxy();
    const result = p.setProxyConfig({ host: 'new.example.com', port: 3128 });
    // setProxyConfig returns upstream config (masked), not local address
    expect(result.host).toBe('new.example.com');
    expect(result.port).toBe(3128);
  });
  it('setProxyConfig preserves password with mask', async () => {
    const p = await loadProxy();
    p.setProxyConfig({ password: 'my-secret' });
    const cfg = p.getUpstreamConfig();
    expect(cfg.password).toBe(p.PASSWORD_MASK);
    // Now update with mask — password should be preserved
    p.setProxyConfig({ password: p.PASSWORD_MASK });
    expect(p.getUpstreamConfig().password).toBe(p.PASSWORD_MASK);
  });
  it('setProxyConfig updates real password', async () => {
    const p = await loadProxy();
    p.setProxyConfig({ password: 'new-secret' });
    // getUpstreamConfig shows masked password
    expect(p.getUpstreamConfig().password).toBe(p.PASSWORD_MASK);
  });
  it('testProxy returns ok on success', async () => {
    const p = await loadProxy();
    const r = await p.testProxy('https://example.com');
    expect(r.ok).toBe(true);
    expect(typeof r.ms).toBe('number');
  });
  it('testProxy returns error on fetch failure', async () => {
    const p = await loadProxy();
    const undici = await import('undici');
    undici.fetch.mockRejectedValueOnce(new Error('Connection refused'));
    const r = await p.testProxy('https://example.com');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Connection refused');
  });
});

describe('proxy env var init', () => {
  it('loads from HTTPS_PROXY', async () => {
    vi.resetModules();
    delete process.env.https_proxy; delete process.env.HTTP_PROXY;
    delete process.env.http_proxy; delete process.env.ALL_PROXY; delete process.env.all_proxy;
    process.env.HTTPS_PROXY = 'https://user:pass@proxy.example.com:8443';
    const p = await import('../lib/proxy.js');
    // getProxyConfig returns local address, not upstream
    expect(p.getProxyConfig().host).toBe('127.0.0.1');
    // getUpstreamConfig shows the env-loaded upstream
    expect(p.getUpstreamConfig().host).toBe('proxy.example.com');
    expect(p.getUpstreamConfig().port).toBe(8443);
  });
  it('handles malformed URL gracefully', async () => {
    vi.resetModules();
    delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY;
    delete process.env.http_proxy; delete process.env.ALL_PROXY; delete process.env.all_proxy;
    process.env.https_proxy = ':::invalid-url:::';
    const p = await import('../lib/proxy.js');
    expect(p.getProxyConfig()).toBeDefined();
  });
});
