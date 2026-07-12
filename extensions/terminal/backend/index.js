/**
 * extensions/terminal/backend/index.js — Terminal plugin backend entry
 *
 * Registers all terminal APIs (list, shells, create, remove, sendInput,
 * readOutput, resize, stream, sleep, wait) via the BackendPluginHost.
 *
 * Follows the EXACT same pattern as browser's backend/index.js:
 *   - host.defineApi(method, handler)          for RPC
 *   - host.defineStream(name, handler)          for streaming (StreamConnection)
 *
 * The shell-manager (PTY infrastructure) is imported as a shared dependency.
 */

import * as terminals from './services/terminals.js';
import * as upgrade from './services/upgrade.js';

/**
 * Activate the terminal plugin backend.
 * @param {import('@agent-type').BackendPluginHost} host
 */
export function activate(host) {
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
  // Follows the browser plugin's defineStream pattern exactly:
  //   host.defineStream(name, (params) => StreamConnection)
  //
  // The transport layer (WebSocket or IPC) sets callbacks before subscribe().
  // The plugin pushes text chunks as { output: string } and signals
  // completion with { type: 'done', exitCode }.

  host.defineStream('stream', (params, io) => {
    const { id } = params || {};
    if (!id) throw new Error('stream: id is required');

    // Resolve initial state eagerly so we can replay history.
    let initialState;
    try {
      initialState = terminals.readTerminalOutput({ id, fromOffset: 0 });
    } catch {
      throw new Error(`Terminal "${id}" not found`);
    }

    /** @type {import('@agent-type').StreamConnection} */
    const conn = {
      subscribe: () => {
        // io captured from handler param — no temporal coupling.
        const { output: history, running, exitCode } = initialState;

        // Replay buffered history first.
        if (history && history.length > 0) {
          io.sendJSON({ output: history });
        }

        // Already exited — send done signal and end immediately.
        if (!running) {
          io.sendJSON({ type: 'done', exitCode: exitCode ?? undefined });
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
            cleanup();
          },
        });

        return { unsubscribe: cleanup };
      },
    };

    return conn;
  });
}
