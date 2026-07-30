/**
 * Tests for backend/lib/mcp-manager/transports/utils.js
 *
 * Covers:
 *   - serializeToolResult: text, image, resource, audio, isError
 *   - wrapTransportError: error code → human message, hostname extraction
 *   - shouldUseProxy: all branches (user flag, proxy config, localhost, noProxy)
 *   - CLIENT_INFO / MCP_PROTOCOL_VERSION constants
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let utils;

beforeEach(async () => {
  const mod = await import('../lib/mcp-manager/transports/utils.js');
  utils = mod;
});

describe('transport utils', () => {
  // ── Constants ──────────────────────────────────────────────────────────

  describe('constants', () => {
    it('CLIENT_INFO has name and version', () => {
      expect(utils.CLIENT_INFO.name).toBe('agent-sdk-backend');
      expect(utils.CLIENT_INFO.version).toBe('0.1.0');
    });

    it('MCP_PROTOCOL_VERSION is 2025-03-26', () => {
      expect(utils.MCP_PROTOCOL_VERSION).toBe('2025-03-26');
    });
  });

  // ── serializeToolResult ────────────────────────────────────────────────

  describe('serializeToolResult', () => {
    it('serializes text content', () => {
      const result = { content: [{ type: 'text', text: 'Hello' }] };
      expect(utils.serializeToolResult(result)).toBe('Hello');
    });

    it('serializes image content with mime type', () => {
      const result = { content: [{ type: 'image', mimeType: 'image/png', data: 'abc' }] };
      expect(utils.serializeToolResult(result)).toBe('[Image: image/png]');
    });

    it('serializes audio content with mime type', () => {
      const result = { content: [{ type: 'audio', mimeType: 'audio/ogg', data: 'raw' }] };
      expect(utils.serializeToolResult(result)).toBe('[Audio: audio/ogg]');
    });

    it('serializes resource content with text', () => {
      const result = { content: [{ type: 'resource', resource: { uri: 'file:///data.txt', text: 'content' } }] };
      expect(utils.serializeToolResult(result)).toBe('content');
    });

    it('serializes resource content without text (URI fallback)', () => {
      const result = { content: [{ type: 'resource', resource: { uri: 'file:///data.bin' } }] };
      expect(utils.serializeToolResult(result)).toBe('[Resource: file:///data.bin]');
    });

    it('joins multiple content blocks with newlines', () => {
      const result = {
        content: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
          { type: 'image', mimeType: 'image/gif', data: 'gifdata' },
        ],
      };
      expect(utils.serializeToolResult(result)).toBe('First\nSecond\n[Image: image/gif]');
    });

    it('prepends [Tool error] when isError is true', () => {
      const result = {
        content: [{ type: 'text', text: 'Something went wrong' }],
        isError: true,
      };
      expect(utils.serializeToolResult(result)).toBe('[Tool error]\nSomething went wrong');
    });

    it('handles empty content array', () => {
      const result = { content: [] };
      expect(utils.serializeToolResult(result)).toBe('');
    });

    it('handles missing content (null safety)', () => {
      expect(utils.serializeToolResult({})).toBe('');
    });
  });

  // ── wrapTransportError ─────────────────────────────────────────────────

  describe('wrapTransportError', () => {
    it('maps ECONNREFUSED to human message', () => {
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      const wrapped = utils.wrapTransportError(err, 'http://localhost:3000');
      expect(wrapped.message).toContain('localhost');
      expect(wrapped.message).toContain('Connection refused');
    });

    it('maps ENOTFOUND to DNS message', () => {
      const err = new Error('getaddrinfo ENOTFOUND');
      err.code = 'ENOTFOUND';
      const wrapped = utils.wrapTransportError(err, 'https://bad.host.example.com/mcp');
      expect(wrapped.message).toContain('bad.host.example.com');
      expect(wrapped.message).toContain('DNS lookup failed');
    });

    it('maps ETIMEDOUT to timeout message', () => {
      const err = new Error('connect ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      const wrapped = utils.wrapTransportError(err, 'https://slow.example.com');
      expect(wrapped.message).toContain('timed out');
    });

    it('maps ECONNRESET', () => {
      const err = new Error('read ECONNRESET');
      err.code = 'ECONNRESET';
      const wrapped = utils.wrapTransportError(err, 'https://reset.example.com');
      expect(wrapped.message).toContain('Connection reset');
    });

    it('maps CERT_HAS_EXPIRED', () => {
      const err = new Error('certificate expired');
      err.code = 'CERT_HAS_EXPIRED';
      const wrapped = utils.wrapTransportError(err, 'https://expired.example.com');
      expect(wrapped.message).toContain('TLS certificate has expired');
    });

    it('falls back to err.message for unknown codes', () => {
      const err = new Error('Something weird happened');
      err.code = 'WEIRD_ERROR_999';
      const wrapped = utils.wrapTransportError(err, 'https://x.com');
      expect(wrapped.message).toContain('Something weird happened');
    });

    it('preserves original error as cause', () => {
      const err = new Error('original');
      err.code = 'ECONNREFUSED';
      const wrapped = utils.wrapTransportError(err, 'http://localhost:1');
      expect(wrapped.cause).toBe(err);
    });

    it('handles malformed URL gracefully', () => {
      const err = new Error('bad');
      err.code = 'ENOTFOUND';
      const wrapped = utils.wrapTransportError(err, 'not-a-valid-url!!!');
      expect(wrapped.message).toContain('not-a-valid-url!!!');
    });

    it('handles cause.code for error codes', () => {
      const err = new Error('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      const wrapped = utils.wrapTransportError(err, 'http://localhost:8080');
      expect(wrapped.message).toContain('Connection refused');
    });
  });

  // ── shouldUseProxy ─────────────────────────────────────────────────────

  describe('shouldUseProxy', () => {
    const proxyCfg = { host: '127.0.0.1', port: 7890, protocol: 'http', noProxy: '' };

    it('returns false when userFlag is false', () => {
      expect(utils.shouldUseProxy('https://api.example.com', false, proxyCfg)).toBe(false);
    });

    it('returns false when no proxy config is provided', () => {
      expect(utils.shouldUseProxy('https://api.example.com', true, null)).toBe(false);
    });

    it('returns false when proxy host is missing', () => {
      expect(utils.shouldUseProxy('https://api.example.com', true, { port: 7890 })).toBe(false);
    });

    it('returns false when proxy port is missing', () => {
      expect(utils.shouldUseProxy('https://api.example.com', true, { host: 'proxy' })).toBe(false);
    });

    it('returns false when port is 0', () => {
      expect(utils.shouldUseProxy('https://api.example.com', true, { host: 'proxy', port: 0 })).toBe(false);
    });

    it('returns true for remote URL with proxy enabled', () => {
      expect(utils.shouldUseProxy('https://api.github.com', true, proxyCfg)).toBe(true);
    });

    it('returns false for localhost (loopback bypass)', () => {
      expect(utils.shouldUseProxy('http://localhost:3000', true, proxyCfg)).toBe(false);
      expect(utils.shouldUseProxy('http://127.0.0.1:8080', true, proxyCfg)).toBe(false);
    });

    it('returns false for 127.x.x.x (full loopback range)', () => {
      expect(utils.shouldUseProxy('http://127.99.88.77:9000', true, proxyCfg)).toBe(false);
    });

    it('returns false for ::1 (IPv6 loopback)', () => {
      expect(utils.shouldUseProxy('http://[::1]:5000', true, proxyCfg)).toBe(false);
    });

    it('returns false for private IPv4 ranges', () => {
      expect(utils.shouldUseProxy('http://192.168.1.1:80', true, proxyCfg)).toBe(false);
      expect(utils.shouldUseProxy('http://10.0.0.1:443', true, proxyCfg)).toBe(false);
      expect(utils.shouldUseProxy('http://172.16.0.1:3000', true, proxyCfg)).toBe(false);
      expect(utils.shouldUseProxy('http://172.31.255.255:8080', true, proxyCfg)).toBe(false);
    });

    it('returns false for link-local (169.254.x.x)', () => {
      expect(utils.shouldUseProxy('http://169.254.0.1:80', true, proxyCfg)).toBe(false);
    });

    it('returns false for malformed URL', () => {
      expect(utils.shouldUseProxy('not-a-url', true, proxyCfg)).toBe(false);
    });

    it('respects noProxy patterns', () => {
      const cfg = { ...proxyCfg, noProxy: '*.internal.com, special.host' };
      expect(utils.shouldUseProxy('https://app.internal.com', true, cfg)).toBe(false);
      expect(utils.shouldUseProxy('https://api.internal.com', true, cfg)).toBe(false);
      expect(utils.shouldUseProxy('https://special.host', true, cfg)).toBe(false);
      // Not matching noProxy
      expect(utils.shouldUseProxy('https://external.com', true, cfg)).toBe(true);
    });

    it('respects semicolon-separated noProxy', () => {
      const cfg = { ...proxyCfg, noProxy: 'a.com;b.com' };
      expect(utils.shouldUseProxy('https://a.com', true, cfg)).toBe(false);
      expect(utils.shouldUseProxy('https://b.com', true, cfg)).toBe(false);
      expect(utils.shouldUseProxy('https://c.com', true, cfg)).toBe(true);
    });

    it('respects space-separated noProxy', () => {
      const cfg = { ...proxyCfg, noProxy: 'x.com y.com' };
      expect(utils.shouldUseProxy('https://x.com', true, cfg)).toBe(false);
      expect(utils.shouldUseProxy('https://y.com', true, cfg)).toBe(false);
    });

    it('handles empty noProxy', () => {
      const cfg = { ...proxyCfg, noProxy: '   ' };
      expect(utils.shouldUseProxy('https://api.example.com', true, cfg)).toBe(true);
    });

    it('handles suffix matching in noProxy', () => {
      const cfg = { ...proxyCfg, noProxy: 'example.com' };
      expect(utils.shouldUseProxy('https://api.example.com', true, cfg)).toBe(false);
      expect(utils.shouldUseProxy('https://example.com', true, cfg)).toBe(false);
    });

    it('handles exact match in noProxy when regex fails', () => {
      const cfg = { ...proxyCfg, noProxy: 'exact.host' };
      // exact.host is a valid hostname, regex version would also work
      expect(utils.shouldUseProxy('https://exact.host', true, cfg)).toBe(false);
    });
  });
});
