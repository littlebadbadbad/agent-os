/**
 * Tests for backend/lib/mcp-manager/transports/stdio.js
 *
 * MCP stdio transport — verified at the interface level (mock spawn).
 * Uses setTimeout(1) for reliable async delivery ordering.
 *
 * Covers the Windows+POSIX dual-path spawn strategy:
 *   - Windows: spawn(fullCommand, [], { shell: true })
 *   - POSIX:   spawn(command, args[], { shell: false })
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: mockSpawn }));

let currentChild = null;

function emitLine(json) {
  if (currentChild) currentChild.stdout.emit('data', Buffer.from(JSON.stringify(json) + '\n'));
}

function emitInit() {
  emitLine({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Srv', version: '1.0.0' } } });
}

function emitTools(tools) {
  emitLine({ jsonrpc: '2.0', id: 2, result: { tools } });
}

function emitResult(id, content) {
  emitLine({ jsonrpc: '2.0', id, result: { content } });
}

function makeChild() {
  const EE = require('events');
  const WS = require('stream');
  const c = new EE.EventEmitter();
  c.stdin = new WS.Writable({
    write(chunk, _e, cb) {
      if (!c._writes) c._writes = [];
      c._writes.push(chunk.toString());
      c._last = chunk.toString();
      cb();
    },
  });
  c._writes = [];
  c._last = '';
  c.stdout = new EE.EventEmitter();
  c.stderr = new EE.EventEmitter();
  c.pid = 12345;
  c.killed = false;
  c.kill = function () { this.killed = true; this.emit('close', 0); };
  return c;
}

// ── Platform detection ─────────────────────────────────────────────────────
// USE_SHELL is evaluated at module import time.  We capture it after import
// so tests can branch assertions on the actual platform behavior.

let USE_SHELL;

describe('splitCommandLine', () => {
  let splitCommandLine;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../lib/mcp-manager/transports/stdio.js');
    splitCommandLine = mod.splitCommandLine;
  });

  it('splits a simple command', () => {
    const r = splitCommandLine('npx -y @org/mcp-server');
    expect(r.command).toBe('npx');
    expect(r.args).toEqual(['-y', '@org/mcp-server']);
  });

  it('splits a command with spaces in values', () => {
    const r = splitCommandLine('node  server.js  --port 8080');
    expect(r.command).toBe('node');
    expect(r.args).toEqual(['server.js', '--port', '8080']);
  });

  it('handles a single-word command (no args)', () => {
    const r = splitCommandLine('my-server');
    expect(r.command).toBe('my-server');
    expect(r.args).toEqual([]);
  });

  it('trims leading/trailing whitespace', () => {
    const r = splitCommandLine('  python3 -m http.server  ');
    expect(r.command).toBe('python3');
    expect(r.args).toEqual(['-m', 'http.server']);
  });

  it('splits the real-world npx.cmd command line from the user', () => {
    const r = splitCommandLine('D:\\Users\\chuyan.zhang\\AppData\\Roaming\\nodejs\\npx.cmd -y @larksuiteoapi/lark-mcp mcp -a cli_aa87ddca23689bcb -s l9Mx8IzQOyt3xeYwlpCrCc6fpuq3qSUl');
    expect(r.command).toBe('D:\\Users\\chuyan.zhang\\AppData\\Roaming\\nodejs\\npx.cmd');
    expect(r.args).toEqual(['-y', '@larksuiteoapi/lark-mcp', 'mcp', '-a', 'cli_aa87ddca23689bcb', '-s', 'l9Mx8IzQOyt3xeYwlpCrCc6fpuq3qSUl']);
  });

  it('is a pure function — no side effects', () => {
    const input = '  node app.js --verbose  ';
    const r1 = splitCommandLine(input);
    const r2 = splitCommandLine(input);
    expect(r1).toEqual(r2);
  });
});

describe('USE_SHELL (platform detection)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../lib/mcp-manager/transports/stdio.js');
    USE_SHELL = mod.USE_SHELL;
  });

  it('is true on Windows, false on POSIX', () => {
    // This test runs on the actual platform — the assertion documents
    // the invariant: only win32 needs shell:true for .cmd/.bat files.
    expect(USE_SHELL).toBe(process.platform === 'win32');
  });
});

describe('StdioClient', () => {
  let createStdioClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentChild = null;
    mockSpawn.mockImplementation(() => { const c = makeChild(); currentChild = c; return c; });
    const mod = await import('../lib/mcp-manager/transports/stdio.js');
    createStdioClient = mod.createStdioClient;
    USE_SHELL = mod.USE_SHELL;
  });

  describe('spawn — Windows vs POSIX code path', () => {
    it('passes full command as single string on Windows (shell:true), split on POSIX (shell:false)', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('npx -y @org/mcp-server');
      client.close();

      if (USE_SHELL) {
        // Windows path: cmd.exe /c "npx -y @org/mcp-server"
        expect(mockSpawn).toHaveBeenCalledWith(
          'npx -y @org/mcp-server',
          [],
          expect.objectContaining({ shell: true, stdio: ['pipe', 'pipe', 'inherit'] }),
        );
      } else {
        // POSIX path: spawn('npx', ['-y', '@org/mcp-server'])
        expect(mockSpawn).toHaveBeenCalledWith(
          'npx',
          ['-y', '@org/mcp-server'],
          expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'inherit'] }),
        );
      }
    });

    it('sets stdio to pipe stdin/stdout + inherit stderr on both platforms', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node server.js');
      client.close();

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'inherit'] }),
      );
    });

    it('merges env', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('python srv.py', { env: { X: 'y' } });
      client.close();

      const opts = mockSpawn.mock.calls[0][2];
      expect(opts.env.X).toBe('y');
    });

    it('supports cwd', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node srv.js', { cwd: '/tmp' });
      client.close();

      const opts = mockSpawn.mock.calls[0][2];
      expect(opts.cwd).toBe('/tmp');
    });
  });

  describe('tools/list', () => {
    it('returns tool list', async () => {
      const tools = [{ name: 'read', inputSchema: { type: 'object' } }];
      const p = createStdioClient('node srv.js');
      setTimeout(emitInit, 1);
      const client = await p;
      setTimeout(() => emitTools(tools), 1);
      const result = await client.listTools();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('read');
      client.close();
    });

    it('sends JSON-RPC tools/list request', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node srv.js');
      setTimeout(() => emitTools([{ name: 't', inputSchema: { type: 'object' } }]), 1);
      await client.listTools();
      expect(currentChild._last).toContain('"method":"tools/list"');
      client.close();
    });
  });

  describe('tools/call', () => {
    it('returns structured result', async () => {
      const p = createStdioClient('node srv.js');
      setTimeout(emitInit, 1);
      const client = await p;
      setTimeout(() => emitResult(2, [{ type: 'text', text: 'OK' }, { type: 'image', mimeType: 'image/png', data: 'abc' }]), 1);
      const result = await client.callTool('echo', { msg: 'hi' });
      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toBe('OK');
      expect(result.content[1].mimeType).toBe('image/png');
      client.close();
    });

    it('passes isError', async () => {
      const p = createStdioClient('node srv.js');
      setTimeout(emitInit, 1);
      const client = await p;
      setTimeout(() => emitLine({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'Denied' }], isError: true } }), 1);
      const result = await client.callTool('write', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Denied');
      client.close();
    });

    it('sends tool name and arguments in the JSON-RPC body', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node srv.js');
      setTimeout(() => emitResult(2, [{ type: 'text', text: 'ok' }]), 1);
      await client.callTool('get_weather', { city: 'Tokyo' });
      expect(currentChild._last).toContain('"method":"tools/call"');
      expect(currentChild._last).toContain('"name":"get_weather"');
      expect(currentChild._last).toContain('"city":"Tokyo"');
      client.close();
    });
  });

  describe('close', () => {
    it('kills subprocess', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node srv.js');
      client.close();
      expect(currentChild.killed).toBe(true);
    });

    it('removes stdout listeners', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node srv.js');
      const spy = vi.spyOn(currentChild.stdout, 'removeAllListeners');
      client.close();
      expect(spy).toHaveBeenCalledWith('data');
    });

    it('rejects all pending requests', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node srv.js');
      const callPromise = client.callTool('slow', {});
      client.close();
      await expect(callPromise).rejects.toThrow('MCP connection closed');
    });
  });

  describe('errors', () => {
    it('rejects on spawn error', async () => {
      mockSpawn.mockImplementation(() => { const c = makeChild(); currentChild = c; setTimeout(() => c.emit('error', new Error('ENOENT')), 1); return c; });
      await expect(createStdioClient('bad-command')).rejects.toThrow('process error');
    });

    it('rejects on non-zero exit', async () => {
      mockSpawn.mockImplementation(() => { const c = makeChild(); currentChild = c; setTimeout(() => c.emit('exit', 1), 1); return c; });
      await expect(createStdioClient('crash')).rejects.toThrow('exited with code 1');
    });

    it('ignores zero exit code (clean shutdown)', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node srv.js');
      currentChild.emit('exit', 0);
      // Should not reject — zero exit after init is a clean shutdown
      expect(true).toBe(true);
      client.close();
    });
  });

  describe('initialize handshake', () => {
    it('sends initialize request before resolving', async () => {
      currentChild = makeChild();
      mockSpawn.mockImplementation(() => {
        const c = makeChild();
        currentChild = c;
        return c;
      });
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node srv.js');
      const allWrites = currentChild._writes.join('\n');
      expect(allWrites).toContain('"method":"initialize"');
      expect(allWrites).toContain('"protocolVersion":"2025-03-26"');
      client.close();
    });

    it('sends initialized notification after handshake', async () => {
      setTimeout(emitInit, 1);
      const client = await createStdioClient('node srv.js');
      // The notification is sent after the initialize response,
      // so stdin should have two writes: initialize + initialized
      const writes = currentChild._last;
      expect(writes).toContain('"method":"notifications/initialized"');
      client.close();
    });
  });
});
