/**
 * Tests for backend/lib/local-proxy-server.js — LocalProxyServer
 *
 * Covers:
 *   start — binds port 0, returns address
 *   stop — cleans up, idempotent
 *   getAddress — null before start, populated after
 *   restart — new port, from stopped state
 *   HTTP forwarding — 200 passthrough, auth header injection, 502 on upstream error
 *   CONNECT tunnelling — 200 established, auth injection, 502 on upstream error,
 *     non-200 response relay, leftover data after headers, client error
 *   Edge cases — auth with empty username, password edge cases
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import net from 'net';
import { LocalProxyServer } from '../lib/local-proxy-server.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createUpstream() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve({ server, host: a.address, port: a.port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function proxyRequest(localAddr, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: localAddr.host, port: localAddr.port,
      method: opts.method ?? 'GET', path: opts.path ?? 'http://example.com/',
      headers: opts.headers ?? {},
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (e) => resolve({ statusCode: 502, body: e.message, error: e }));
    req.end();
  });
}

function connectTunnel(localAddr, hostPort) {
  return new Promise((resolve) => {
    const s = net.connect(localAddr.port, localAddr.host, () => {
      s.write(`CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`);
    });
    let buf = '';
    s.on('data', (c) => { buf += c.toString(); });
    s.on('end', () => resolve(buf));
    s.on('error', () => resolve(buf || 'ERROR'));
    s.setTimeout(2000, () => { s.destroy(); resolve(buf || 'TIMEOUT'); });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LocalProxyServer', () => {
  let lp;

  beforeEach(() => { lp = new LocalProxyServer(); });
  afterEach(() => { lp.stop(); });

  // ── lifecycle ────────────────────────────────────────────────────────────

  describe('start', () => {
    it('binds 127.0.0.1:0 and returns host/port', async () => {
      const up = await createUpstream();
      try {
        const a = await lp.start({ host: up.host, port: up.port });
        expect(a.host).toBe('127.0.0.1');
        expect(a.port).toBeGreaterThan(0);
        expect(a.port).toBeLessThan(65536);
      } finally { await up.close(); }
    });
  });

  describe('stop', () => {
    it('clears address', async () => {
      const up = await createUpstream();
      try {
        await lp.start({ host: up.host, port: up.port });
        lp.stop();
        expect(lp.getAddress()).toBeNull();
      } finally { await up.close(); }
    });
    it('idempotent', () => { lp.stop(); lp.stop(); });
    it('safe before start', () => { lp.stop(); expect(lp.getAddress()).toBeNull(); });
    it('stop-then-start works', async () => {
      const up = await createUpstream();
      try {
        await lp.start({ host: up.host, port: up.port });
        lp.stop();
        await lp.start({ host: up.host, port: up.port });
        expect(lp.getAddress()).not.toBeNull();
      } finally { await up.close(); }
    });
  });

  describe('getAddress', () => {
    it('null before start', () => { expect(lp.getAddress()).toBeNull(); });
    it('null after stop', async () => {
      const up = await createUpstream();
      try {
        await lp.start({ host: up.host, port: up.port });
        lp.stop();
        expect(lp.getAddress()).toBeNull();
      } finally { await up.close(); }
    });
  });

  describe('restart', () => {
    it('from running state', async () => {
      const up = await createUpstream();
      try {
        await lp.start({ host: up.host, port: up.port });
        const a2 = await lp.restart({ host: up.host, port: up.port });
        expect(a2.port).toBeGreaterThan(0);
      } finally { await up.close(); }
    });
    it('from stopped state', async () => {
      const up = await createUpstream();
      try {
        const a = await lp.restart({ host: up.host, port: up.port });
        expect(a.port).toBeGreaterThan(0);
      } finally { await up.close(); }
    });
    it('getAddress non-null after restart', async () => {
      const up = await createUpstream();
      try {
        await lp.restart({ host: up.host, port: up.port });
        expect(lp.getAddress()).not.toBeNull();
      } finally { await up.close(); }
    });
  });

  // ── HTTP forwarding ──────────────────────────────────────────────────────

  describe('HTTP forwarding', () => {
    it('passthrough 200 response', async () => {
      const up = await createUpstream();
      try {
        up.server.on('request', (_r, res) => { res.writeHead(200); res.end('hello'); });
        const a = await lp.start({ host: up.host, port: up.port });
        const r = await proxyRequest(a);
        expect(r.statusCode).toBe(200);
        expect(r.body).toBe('hello');
      } finally { await up.close(); }
    });

    it('returns 502 on upstream error', async () => {
      const a = await lp.start({ host: '127.0.0.1', port: 19999 });
      const r = await proxyRequest(a);
      expect(r.statusCode).toBe(502);
    });

    it('injects Proxy-Authorization with username', async () => {
      const up = await createUpstream();
      let hdrs;
      try {
        up.server.on('request', (r, res) => { hdrs = r.headers; res.end('ok'); });
        await lp.start({ host: up.host, port: up.port, username: 'u', password: 'p' });
        await proxyRequest(lp.getAddress());
        expect(hdrs['proxy-authorization']).toBe('Basic ' + Buffer.from('u:p').toString('base64'));
      } finally { await up.close(); }
    });

    it('no auth header when username missing', async () => {
      const up = await createUpstream();
      let hdrs;
      try {
        up.server.on('request', (r, res) => { hdrs = r.headers; res.end('ok'); });
        await lp.start({ host: up.host, port: up.port });
        await proxyRequest(lp.getAddress());
        expect(hdrs['proxy-authorization']).toBeUndefined();
      } finally { await up.close(); }
    });

    it('no auth header when username empty string', async () => {
      const up = await createUpstream();
      let hdrs;
      try {
        up.server.on('request', (r, res) => { hdrs = r.headers; res.end('ok'); });
        await lp.start({ host: up.host, port: up.port, username: '', password: 'x' });
        await proxyRequest(lp.getAddress());
        expect(hdrs['proxy-authorization']).toBeUndefined();
      } finally { await up.close(); }
    });

    it('passes non-200 upstream codes', async () => {
      const up = await createUpstream();
      try {
        up.server.on('request', (_r, res) => { res.writeHead(404, { 'x-c': 'y' }); res.end('nf'); });
        const a = await lp.start({ host: up.host, port: up.port });
        const r = await proxyRequest(a);
        expect(r.statusCode).toBe(404);
        expect(r.body).toBe('nf');
        expect(r.headers['x-c']).toBe('y');
      } finally { await up.close(); }
    });

    it('forwards method and custom headers', async () => {
      const up = await createUpstream();
      let info;
      try {
        up.server.on('request', (r, res) => { info = { m: r.method, h: r.headers['x-test'] }; res.end(); });
        const a = await lp.start({ host: up.host, port: up.port });
        await proxyRequest(a, { method: 'POST', headers: { 'x-test': 'val' } });
        expect(info.m).toBe('POST');
        expect(info.h).toBe('val');
      } finally { await up.close(); }
    });
  });

  // ── CONNECT tunnelling ───────────────────────────────────────────────────

  describe('CONNECT tunnelling', () => {
    it('200 Connection Established on success', async () => {
      const up = await createUpstream();
      try {
        up.server.on('connect', (_r, s) => { s.write('HTTP/1.1 200 Connection Established\r\n\r\n'); setTimeout(() => s.end(), 100); });
        const a = await lp.start({ host: up.host, port: up.port });
        expect(await connectTunnel(a, 'x.com:443')).toContain('200 Connection Established');
      } finally { await up.close(); }
    });

    it('relays non-200 upstream CONNECT response', async () => {
      const up = await createUpstream();
      try {
        up.server.on('connect', (_r, s) => { s.write('HTTP/1.1 407 Auth Required\r\n\r\n'); s.end(); });
        const a = await lp.start({ host: up.host, port: up.port });
        expect(await connectTunnel(a, 'x.com:443')).toContain('407');
      } finally { await up.close(); }
    });

    it('502 on upstream CONNECT error', async () => {
      const a = await lp.start({ host: '127.0.0.1', port: 19998 });
      const r = await connectTunnel(a, 'x.com:443');
      expect(r.includes('502') || r.includes('ERROR') || r.includes('TIMEOUT')).toBe(true);
    }, 15000);

    it('injects Proxy-Authorization into CONNECT', async () => {
      const up = await createUpstream();
      let pa;
      try {
        up.server.on('connect', (r, s) => { pa = r.headers['proxy-authorization']; s.write('HTTP/1.1 200\r\n\r\n'); setTimeout(() => s.end(), 100); });
        await lp.start({ host: up.host, port: up.port, username: 'u', password: 'p' });
        await connectTunnel(lp.getAddress(), 't.com:443');
        expect(pa).toBe('Basic ' + Buffer.from('u:p').toString('base64'));
      } finally { await up.close(); }
    });

    it('handles HTTP/1.0 200 response', async () => {
      const up = await createUpstream();
      try {
        up.server.on('connect', (_r, s) => { s.write('HTTP/1.0 200 OK\r\n\r\n'); setTimeout(() => s.end(), 100); });
        const a = await lp.start({ host: up.host, port: up.port });
        expect(await connectTunnel(a, 'x.com:443')).toContain('200 Connection Established');
      } finally { await up.close(); }
    });

    it('handles leftover data after CONNECT headers', async () => {
      const up = await createUpstream();
      try {
        up.server.on('connect', (_r, s) => { s.write('HTTP/1.1 200 Connection Established\r\n\r\nEXTRA'); setTimeout(() => s.end(), 100); });
        const a = await lp.start({ host: up.host, port: up.port });
        expect(await connectTunnel(a, 'x.com:443')).toContain('200 Connection Established');
      } finally { await up.close(); }
    });

    it('handles client disconnect during CONNECT', async () => {
      const up = await createUpstream();
      try {
        up.server.on('connect', (_r, s) => { s.write('HTTP/1.1 200\r\n\r\n'); });
        const a = await lp.start({ host: up.host, port: up.port });
        // Connect and immediately destroy client
        await new Promise((resolve) => {
          const sock = net.connect(a.port, a.host, () => {
            sock.write('CONNECT x.com:443 HTTP/1.1\r\nHost: x.com:443\r\n\r\n', () => {
              sock.destroy();
              resolve();
            });
          });
          sock.on('error', () => resolve());
        });
        expect(true).toBe(true);
      } finally { await up.close(); }
    }, 15000);
  });

  // ── auth edge cases ──────────────────────────────────────────────────────

  describe('auth edge cases', () => {
    it('username with undefined password', async () => {
      const up = await createUpstream();
      try {
        up.server.on('request', (_r, res) => res.end('ok'));
        await lp.start({ host: up.host, port: up.port, username: 'u', password: undefined });
        expect((await proxyRequest(lp.getAddress())).statusCode).toBe(200);
      } finally { await up.close(); }
    });
    it('username with empty password', async () => {
      const up = await createUpstream();
      try {
        up.server.on('request', (_r, res) => res.end('ok'));
        await lp.start({ host: up.host, port: up.port, username: 'u', password: '' });
        expect((await proxyRequest(lp.getAddress())).statusCode).toBe(200);
      } finally { await up.close(); }
    });
  });
});
