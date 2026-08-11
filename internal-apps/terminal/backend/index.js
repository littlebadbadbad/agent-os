/**
 * internal-apps/terminal/backend/index.js — Terminal app backend entry
 *
 * Registers all terminal APIs (list, shells, create, remove, sendInput,
 * readOutput, resize, stream, sleep, wait) via the BackendAppHost.
 *
 * Follows the EXACT same pattern as browser's backend/index.js:
 *   - host.defineApi(method, handler)          for RPC
 *   - host.defineStream(name, handler)          for streaming (StreamConnection)
 *
 * The shell-manager (PTY infrastructure) is imported as a shared dependency.
 */

import * as terminals from './services/terminals.js';
import * as upgrade from './services/upgrade.js';

/** @import { BackendAppHost, StreamConnection } from '@agent-type' */
/** @import { TerminalService } from '@agent-type/services' */

/** @type {(() => void) | undefined} */
let _unregisterService;

/**
 * Activate the terminal app backend.
 * @param {BackendAppHost} host
 */
export function activate(host) {
  upgrade.init(host);

  // ── Inter-app service registration ───────────────────────────────────
  // Expose the full terminal management surface so other backend apps
  // (e.g., MCP for stdio transport) can create and control terminals
  // without going through the agent layer.

  /** @type {TerminalService} */
  const terminalService = {
    listTerminals: () => terminals.listTerminals(),
    availableShells: () => ({ shells: terminals.availableShells() }),
    createTerminalSession: (params) => terminals.createTerminalSession(params),
    spawnCommand: (params) => terminals.spawnCommandSession(params),
    runCommand: (params) => terminals.runCommand(params),
    removeTerminalSession: (params) => terminals.removeTerminalSession(params),
    sendTerminalInput: (params) => terminals.sendTerminalInput(params),
    readTerminalOutput: (params) => terminals.readTerminalOutput(params),
    resizeTerminalSession: (params) => terminals.resizeTerminalSession(params),
    waitTerminal: (params) => terminals.waitTerminal(params),
    sleepTerminal: (params) => terminals.sleepTerminal(params),
    cancelWait: (params) => terminals.cancelWait(params),
    subscribeTerminalOutput: (params) => terminals.subscribeTerminalOutput(params),
  };

  _unregisterService = host.services.register('terminal', terminalService);

  // ── RPC APIs ──────────────────────────────────────────────────────────────

  host.defineApi('list', async (_params) => {
    return terminals.listTerminals();
  });

  host.defineApi('shells', async (_params) => {
    const shells = terminals.availableShells();
    return { shells };
  });

  host.defineApi('create', async (params) => {
    return terminals.createTerminalSession(params);
  });

  host.defineApi('remove', async (params) => {
    return terminals.removeTerminalSession(params);
  });

  host.defineApi('sendInput', async (params) => {
    return terminals.sendTerminalInput(params);
  });

  host.defineApi('readOutput', async (params) => {
    return terminals.readTerminalOutput(params);
  });

  host.defineApi('resize', async (params) => {
    return terminals.resizeTerminalSession(params);
  });

  host.defineApi('wait', async (params) => {
    return terminals.waitTerminal(params);
  });

  host.defineApi('sleep', async (params) => {
    return terminals.sleepTerminal(params);
  });

  host.defineApi('cancelWait', async (params) => {
    return terminals.cancelWait(params);
  });

  // ── Upgrade APIs ──────────────────────────────────────────────────────

  host.defineApi('upgrade.version', async (_params) => {
    return { version: upgrade.getVersion() };
  });

  host.defineApi('upgrade.build', async (params) => {
    if (!upgrade.acquireBuildLock()) {
      throw new Error('A build is already in progress.');
    }
    try {
      const inputTerminalId =
        typeof params?.terminalId === 'string' ? params.terminalId : undefined;
      return upgrade.startBuild({ terminalId: inputTerminalId });
    } catch (err) {
      upgrade.releaseBuildLock();
      throw err;
    }
  });

  host.defineApi('upgrade.restart', async (_params) => {
    if (!upgrade.IS_PKG) {
      throw new Error(
        'Restart is only available when running as a packaged executable.',
      );
    }
    upgrade.restartProcess();
    return { status: 'restarting' };
  });

  host.defineApi('upgrade.devStart', async (_params) => {
    return upgrade.startDevServer();
  });

  host.defineApi('upgrade.devStop', async (_params) => {
    return upgrade.stopDevServer();
  });

  host.defineApi('upgrade.devStatus', async (_params) => {
    return upgrade.getDevServerStatus();
  });

  host.defineApi('upgrade.runTests', async (params) => {
    const valid = upgrade.validateTestParams(params);
    if (!upgrade.acquireTestLock()) {
      throw new Error('A test run is already in progress.');
    }
    try {
      return upgrade.startTest({
        target: valid.target,
        args: valid.argsStr,
        terminalId: params?.terminalId,
      });
    } catch (err) {
      upgrade.releaseTestLock();
      throw err;
    }
  });

  // ── Stream ────────────────────────────────────────────────────────────────
  //
  // Follows the browser app's defineStream pattern exactly:
  //   host.defineStream(name, (params) => StreamConnection)
  //
  // The transport layer (WebSocket or IPC) sets callbacks before subscribe().
  // The app pushes text chunks as { output: string } and signals
  // completion with { type: 'done', exitCode }.

  host.defineStream('stream', (params, io) => {
    const { id } = params || {};
    if (!id) throw new Error('stream: id is required');

    /** @type {StreamConnection} */
    const conn = {
      subscribe: () => {
        // Read buffered history at subscribe time (not at connect time),
        // so there is no gap between history replay and live subscription.
        // In single-threaded JS there is no yield between the read and
        // the subscribeTerminalOutput call below — every byte is captured.
        let initialState;
        try {
          initialState = terminals.readTerminalOutput({ id, fromOffset: 0 });
        } catch {
          throw new Error(`Terminal "${id}" not found`);
        }

        const { output: history, running, exitCode } = initialState;

        // Replay buffered history first.
        if (history && history.length > 0) {
          io.sendJSON({ output: history });
        }

        // Already exited — send done signal and end immediately.
        if (!running) {
          io.sendJSON({ type: 'done', exitCode: exitCode ?? undefined });
          io.close();
          return { unsubscribe: () => {} };
        }

        // Subscribe to live terminal output.
        const ctrl = new AbortController();
        const cleanup = () => ctrl.abort();

        terminals.subscribeTerminalOutput({
          id,
          signal: ctrl.signal,
          onOutput: (text) => {
            io.sendJSON({ output: text });
          },
          onDone: (code) => {
            io.sendJSON({ type: 'done', exitCode: code ?? undefined });
            io.close();
            cleanup();
          },
        });

        return { unsubscribe: cleanup };
      },
    };

    return conn;
  });
}

/**
 * Deactivate hook — called by the app lifecycle when the app is
 * disabled or uninstalled.  Unregisters inter-app services and kills
 * all PTY terminal processes.
 * Symmetric to activate(host).
 */
export function deactivate() {
  if (_unregisterService) {
    _unregisterService();
    _unregisterService = undefined;
  }
  terminals.killAllTerminals();
}
