/**
 * MCP stdio transport.
 *
 * Launches the MCP server as a subprocess and communicates via stdin/stdout.
 * JSON-RPC messages are delimited by newlines (one JSON-RPC message per line).
 *
 * The server MAY write UTF-8 strings to stderr for logging purposes.
 *
 * ── Shell behavior ─────────────────────────────────────────────────────────
 * stdio MCP servers are always invoked through a shell on Windows (where .cmd
 * files like `npx.cmd` cannot be spawned directly without `shell: true`).
 * On POSIX, direct spawn is used to avoid shell quoting issues.
 */

import { spawn } from 'child_process';
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

/** Whether the current platform needs a shell to run .cmd/.bat files. */
export const USE_SHELL = process.platform === 'win32';

/**
 * Split a command line string into command and args array.
 * Simple whitespace split that handles the common case.
 */
export function splitCommandLine(commandLine) {
  const parts = commandLine.trim().split(/\s+/);
  return { command: parts[0], args: parts.slice(1) };
}

/**
 * Create a stdio-based MCP client by spawning the server as a subprocess.
 *
 * @param {string} commandLine - Full command string, e.g. "npx -y @org/mcp-server".
 *                               On Windows this is passed to `cmd.exe /c <commandLine>`.
 *                               On POSIX it is split and spawned directly.
 * @param {{cwd?:string, env?:Record<string,string>}} [options]
 * @returns {Promise<McpStdioClient>}
 */
export async function createStdioClient(commandLine, { cwd, env } = {}) {
  let requestId = 0;
  let closed = false;

  // ── Spawn subprocess ───────────────────────────────────────────────────
  const child = USE_SHELL
    ? spawn(commandLine, [], {
        stdio: ['pipe', 'pipe', 'inherit'],
        shell: true,
        cwd,
        env: { ...process.env, ...env },
      })
    : (() => {
        const { command, args } = splitCommandLine(commandLine);
        return spawn(command, args, {
          stdio: ['pipe', 'pipe', 'inherit'],
          shell: false,
          cwd,
          env: { ...process.env, ...env },
        });
      })();

  /** @type {Map<number, {resolve:(v:unknown)=>void, reject:(e:Error)=>void}>} */
  const pending = new Map();

  // ── Line-by-line reader on stdout ─────────────────────────────────────
  let stdoutBuffer = '';

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch { /* ignore unparseable lines */ }
    }
  });

  child.on('error', (err) => {
    const connErr = new Error(`MCP stdio process error: ${err.message}`);
    for (const p of pending.values()) p.reject(connErr);
    pending.clear();
  });

  child.on('exit', (code) => {
    if (!closed && code !== 0 && code !== null) {
      const connErr = new Error(`MCP stdio process exited with code ${code}`);
      for (const p of pending.values()) p.reject(connErr);
      pending.clear();
    }
  });

  // ── Send helpers ───────────────────────────────────────────────────────

  /**
   * @param {string} method
   * @param {Record<string,unknown>} [params]
   * @returns {Promise<unknown>}
   */
  function sendRequest(method, params = {}) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      if (closed) { reject(new Error('MCP connection closed')); return; }
      pending.set(id, { resolve, reject });
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      child.stdin.write(body + '\n');
    });
  }

  /**
   * @param {string} method
   * @param {Record<string,unknown>} [params]
   */
  function sendNotification(method, params = {}) {
    if (closed || !child.stdin.writable) return;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  // ── Initialize handshake ───────────────────────────────────────────────
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
      child.stdout.removeAllListeners?.('data');
      const err = new Error('MCP connection closed');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      if (!child.killed) {
        child.kill();
      }
    },
  };
}
