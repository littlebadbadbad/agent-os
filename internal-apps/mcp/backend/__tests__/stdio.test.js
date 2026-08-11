/**
 * Tests for backend/lib/mcp-manager/transports/stdio.js
 *
 * MCP stdio transport — verified at the interface level (mock TerminalService).
 * Uses setTimeout(1) for reliable async delivery ordering.
 *
 * The stdio transport delegates shell lifecycle to the terminal app's
 * cross-app service instead of raw child_process.spawn().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════════
//  Mock TerminalService
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulates a terminal session with input/output buffers.
 */
function makeMockTerminalService() {
  /** @type {string} */
  let outputBuffer = '';

  /** @type {{ id: string, text: string }[]} */
  const inputs = [];

  /** @type {boolean} */
  let closed = false;

  return {
    // ── Inspection helpers for assertions ──────────────────────────────
    _inputs: inputs,
    _markClosed() { closed = true; },

    /**
     * Queue output that will be returned by readTerminalOutput on next poll.
     * @param {string} text
     */
    _emitText(text) {
      outputBuffer += text;
    },

    /**
     * Queue a JSON-RPC response (auto-encodes as JSON + '\n').
     * @param {object} json
     */
    _emitJson(json) {
      outputBuffer += JSON.stringify(json) + '\n';
    },

    // ── TerminalService methods ────────────────────────────────────────

    spawnCommand(params) {
      const id = 'mcp-stdio-' + Math.random().toString(36).slice(2, 8);
      return {
        id,
        label: params.label ?? 'mcp-stdio',
        shell: params.commandLine,
        cwd: params.cwd ?? null,
        running: true,
        exitCode: null,
        createdAt: new Date().toISOString(),
        outputBytes: 0,
      };
    },

    createTerminalSession() {
      throw new Error('unexpected createTerminalSession call');
    },

    sendTerminalInput(params) {
      inputs.push({ id: params.id, text: params.text });
      return { ok: true };
    },

    readTerminalOutput(params) {
      const fromOffset = params.fromOffset ?? 0;
      const data = outputBuffer.slice(fromOffset);
      return {
        output: data,
        offset: outputBuffer.length,
        running: !closed,
        exitCode: closed ? 0 : undefined,
      };
    },

    removeTerminalSession(_params) {
      closed = true;
      return { ok: true };
    },

    // ── Stubs (unused by stdio transport) ──────────────────────────────
    listTerminals() { return { terminals: [] }; },
    availableShells() { return { shells: [] }; },
    resizeTerminalSession() {},
    waitTerminal() {
      return Promise.resolve({ output: '', offset: 0, running: false, timedOut: false, reason: 'exited' });
    },
    sleepTerminal() { return Promise.resolve({ slept: 0, aborted: false }); },
    cancelWait() {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Emit the standard MCP initialize response (id:1).
 */
function emitInit(terminal) {
  terminal._emitJson({
    jsonrpc: '2.0', id: 1,
    result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Srv', version: '1.0.0' } },
  });
}

/**
 * Emit a tools/list response (id:2).
 */
function emitTools(terminal, tools) {
  terminal._emitJson({ jsonrpc: '2.0', id: 2, result: { tools } });
}

/**
 * Emit a tools/call response with the given id.
 */
function emitResult(terminal, id, content, isError = false) {
  terminal._emitJson({
    jsonrpc: '2.0', id,
    result: { content, ...(isError ? { isError: true } : {}) },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('StdioClient (TerminalService-backed)', () => {
  let createStdioClient;
  /** @type {ReturnType<typeof makeMockTerminalService>} */
  let terminal;

  beforeEach(async () => {
    vi.clearAllMocks();
    terminal = makeMockTerminalService();
    const mod = await import('../lib/mcp-manager/transports/stdio.js');
    createStdioClient = mod.createStdioClient;
  });

  // ── Session creation ─────────────────────────────────────────────────────

  it('launches via spawnCommand with the full command line', async () => {
    let capturedCommandLine;
    const orig = terminal.spawnCommand.bind(terminal);
    terminal.spawnCommand = (params) => {
      capturedCommandLine = params.commandLine;
      return orig(params);
    };

    emitInit(terminal);
    const client = await createStdioClient('npx -y @org/mcp-server', terminal);
    client.close();

    expect(capturedCommandLine).toBe('npx -y @org/mcp-server');
  });

  it('creates a terminal session and sends initialize handshake', async () => {
    emitInit(terminal);
    const client = await createStdioClient('npx -y @org/mcp-server', terminal);
    client.close();

    const initInput = terminal._inputs.find((i) => i.text.includes('"method":"initialize"'));
    expect(initInput).toBeDefined();
    expect(initInput.text).toContain('"protocolVersion"');
    expect(initInput.text).toContain('"capabilities"');
  });

  it('sends initialized notification after initialize', async () => {
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);
    client.close();

    const notif = terminal._inputs.find((i) => i.text.includes('"notifications/initialized"'));
    expect(notif).toBeDefined();
  });

  it('passes cwd to spawnCommand', async () => {
    emitInit(terminal);

    let capturedCwd;
    const orig = terminal.spawnCommand.bind(terminal);
    terminal.spawnCommand = (params) => {
      capturedCwd = params.cwd;
      return orig(params);
    };

    const client = await createStdioClient('node srv.js', terminal, { cwd: '/tmp' });
    client.close();
    expect(capturedCwd).toBe('/tmp');
  });

  // ── tools/list ───────────────────────────────────────────────────────────

  it('returns tool list', async () => {
    const tools = [{ name: 'read', inputSchema: { type: 'object' } }];
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);
    setTimeout(() => emitTools(terminal, tools), 1);
    const result = await client.listTools();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('read');
    client.close();
  });

  it('sends JSON-RPC tools/list request', async () => {
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);
    setTimeout(() => emitTools(terminal, [{ name: 't', inputSchema: { type: 'object' } }]), 1);
    await client.listTools();

    const listCall = terminal._inputs.find((i) => i.text.includes('"method":"tools/list"'));
    expect(listCall).toBeDefined();
    client.close();
  });

  // ── tools/call ───────────────────────────────────────────────────────────

  it('returns structured result', async () => {
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);
    setTimeout(() => emitResult(terminal, 2, [{ type: 'text', text: 'OK' }, { type: 'image', mimeType: 'image/png', data: 'abc' }]), 1);
    const result = await client.callTool('echo', { msg: 'hi' });
    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toBe('OK');
    expect(result.content[1].mimeType).toBe('image/png');
    client.close();
  });

  it('passes isError', async () => {
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);
    setTimeout(() => emitResult(terminal, 2, [{ type: 'text', text: 'Denied' }], true), 1);
    const result = await client.callTool('write', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Denied');
    client.close();
  });

  it('sends tool name and arguments in the JSON-RPC body', async () => {
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);
    setTimeout(() => emitResult(terminal, 2, [{ type: 'text', text: 'ok' }]), 1);
    await client.callTool('get_weather', { city: 'Tokyo' });

    const callInput = terminal._inputs.find((i) => i.text.includes('"method":"tools/call"'));
    expect(callInput).toBeDefined();
    expect(callInput.text).toContain('"name":"get_weather"');
    expect(callInput.text).toContain('"city":"Tokyo"');
    client.close();
  });

  // ── close ────────────────────────────────────────────────────────────────

  it('removes the terminal session on close', async () => {
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);

    let removeCalled = false;
    const origRemove = terminal.removeTerminalSession.bind(terminal);
    terminal.removeTerminalSession = (params) => {
      removeCalled = true;
      return origRemove(params);
    };

    client.close();
    expect(removeCalled).toBe(true);
  });

  it('rejects all pending requests on close', async () => {
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);
    // Don't emit a response — let it hang
    const callPromise = client.callTool('slow', {});
    client.close();
    await expect(callPromise).rejects.toThrow('MCP connection closed');
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it('handles MCP error responses', async () => {
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);
    setTimeout(() => {
      terminal._emitJson({ jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found' } });
    }, 1);
    await expect(client.callTool('nonexistent', {})).rejects.toThrow('Method not found');
    client.close();
  });

  it('ignores non-JSON lines in terminal output', async () => {
    emitInit(terminal);
    const client = await createStdioClient('node srv.js', terminal);
    // Emit garbage (simulating stderr), then the actual response
    terminal._emitText('some stderr noise\n');
    setTimeout(() => emitResult(terminal, 2, [{ type: 'text', text: 'OK' }]), 1);
    const result = await client.callTool('test', {});
    expect(result.content[0].text).toBe('OK');
    client.close();
  });
});
