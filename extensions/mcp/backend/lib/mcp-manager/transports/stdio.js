/**
 * MCP stdio transport — TerminalService-backed implementation.
 *
 * Uses the terminal plugin's `spawnCommand` (child_process.spawn) instead
 * of node-pty `createTerminalSession`.  This is essential for Windows where
 * .cmd/.bat files (npx.cmd, etc.) cannot be resolved by node-pty but work
 * fine with `spawn({ shell: true })`.
 *
 * Protocol
 *   JSON-RPC 2.0 over stdio: one message per line on stdout.
 *   Communication uses sendTerminalInput / readTerminalOutput on the spawned
 *   session's id.
 */

/**
 * @typedef {import('@agent-type/services').TerminalService} TerminalService
 */

import { CLIENT_INFO, MCP_PROTOCOL_VERSION } from './utils.js';

/**
 * @typedef {import('./utils.js').ToolCallResult} ToolCallResult
 */

/**
 * @typedef {object} ToolDef
 * @property {string} name
 * @property {string} [description]
 * @property {object} inputSchema
 */

/**
 * @typedef {object} McpStdioClient
 * @property {() => Promise<readonly ToolDef[]>} listTools
 * @property {(name:string, args:Record<string,unknown>) => Promise<ToolCallResult>} callTool
 * @property {() => void} close
 */

/** Poll interval when waiting for terminal output (ms). */
const POLL_INTERVAL_MS = 50;

/**
 * Read all available lines from the terminal since `startOffset`,
 * non-blocking.  Returns parsed JSON messages keyed by id, plus the
 * next offset to use on the next call.
 *
 * @param {TerminalService} terminal
 * @param {string} terminalId
 * @param {number} startOffset
 * @returns {{ byId: Map<number, object>, nextOffset: number }}
 */
function drainLines(terminal, terminalId, startOffset) {
  const result = terminal.readTerminalOutput({ id: terminalId, fromOffset: startOffset });
  const text = result.output;

  /** @type {Map<number, object>} */
  const byId = new Map();

  const lines = text.split('\n');
  // Discard the last element — it's either empty (if text ends with \n)
  // or a partial line (no terminating \n).
  lines.pop();

  let consumed = 0;
  for (const raw of lines) {
    consumed += raw.length + 1; // +1 for the \n

    let msg;
    try { msg = JSON.parse(raw); } catch { continue; }

    // Only collect JSON-RPC responses (not requests/notifications/echoes).
    if (!('result' in msg) && !('error' in msg)) continue;
    if (typeof msg.id !== 'number') continue;

    byId.set(/** @type {number} */ (msg.id), msg);
  }

  return { byId, nextOffset: startOffset + consumed };
}

/**
 * Wait for a JSON-RPC response with a specific id, polling the terminal.
 *
 * No hard deadline — studio-class MCP servers (especially npx-based ones)
 * can take minutes to download and install dependencies on first run.
 * The only cancellation path is the AbortSignal fired by close().
 *
 * Each call is self-contained: drains lines, checks for the target id,
 * and sleeps briefly if not found.  No shared reader loop, no races.
 *
 * @param {TerminalService} terminal
 * @param {string} terminalId
 * @param {number} startOffset
 * @param {number} id
 * @param {AbortSignal} signal
 * @returns {Promise<{ response: object, nextOffset: number }>}
 */
async function awaitResponse(terminal, terminalId, startOffset, id, signal) {
  let offset = startOffset;

  for (;;) {
    if (signal.aborted) throw new Error('MCP stdio request aborted');

    const { byId, nextOffset } = drainLines(terminal, terminalId, offset);
    offset = nextOffset;

    const response = byId.get(id);
    if (response) {
      return { response, nextOffset: offset };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Create a stdio-based MCP client backed by the TerminalService.
 *
 * Uses `terminal.spawnCommand()` (child_process.spawn with shell:true)
 * instead of node-pty — essential for .cmd/.bat on Windows.
 *
 * @param {string} commandLine - Full command string, e.g. "npx -y @org/mcp-server".
 * @param {TerminalService} terminal - Resolved cross-plugin terminal service.
 * @param {{cwd?:string}} [options]
 * @returns {Promise<McpStdioClient>}
 */
export async function createStdioClient(commandLine, terminal, { cwd } = {}) {
  let requestId = 0;
  let closed = false;

  /** Tracks how many bytes of terminal output have already been consumed. */
  let readOffset = 0;

  /** @type {AbortController} */
  const abortController = new AbortController();

  const session = terminal.spawnCommand({
    commandLine,
    cwd,
    label: `mcp-stdio:${commandLine.slice(0, 40)}`,
  });

  /**
   * Send a JSON-RPC request and wait for the matching response.
   * Each call drains output lines and matches by id — no shared state
   * apart from `readOffset` which advances monotonically.
   *
   * @param {string} method
   * @param {Record<string,unknown>} [params]
   * @returns {Promise<unknown>}
   */
  async function sendRequest(method, params = {}) {
    if (closed) throw new Error('MCP connection closed');

    const id = ++requestId;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    terminal.sendTerminalInput({ id: session.id, text: body });

    const { response, nextOffset } = await awaitResponse(
      terminal,
      session.id,
      readOffset,
      id,
      abortController.signal,
    );
    readOffset = nextOffset;

    if (response.error) {
      throw new Error(
        `MCP error [${response.error.code}]: ${response.error.message}`,
      );
    }
    return response.result;
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   * @param {string} method
   * @param {Record<string,unknown>} [params]
   */
  function sendNotification(method, params = {}) {
    if (closed) return;
    terminal.sendTerminalInput({
      id: session.id,
      text: JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n',
    });
  }

  await sendRequest('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: CLIENT_INFO,
  });
  sendNotification('notifications/initialized');

  return {
    async listTools() {
      const result = await sendRequest('tools/list');
      return (result && typeof result === 'object' && 'tools' in result)
        ? /** @type {{tools:readonly ToolDef[]}} */ (result).tools
        : [];
    },

    async callTool(name, args) {
      const result = await sendRequest('tools/call', { name, arguments: args });
      return /** @type {ToolCallResult} */ (result);
    },

    close() {
      closed = true;
      abortController.abort();
      try { terminal.removeTerminalSession({ id: session.id }); } catch { /* ignore */ }
    },
  };
}
