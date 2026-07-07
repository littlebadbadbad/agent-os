/**
 * src/tools/terminal/ipcAdapter.ts — Electron IPC adapter for terminal operations
 *
 * Uses window.electronAPI.invoke() and on() for streaming instead of SSE.
 */

import type {
  TerminalEntry,
  TerminalOutput,
  TerminalManagerAdapter,
  ShellFamily,
  AvailableShell,
} from './types';

/** No config needed — IPC channel names are fixed at build time. */
export type IpcTerminalAdapterConfig = Record<string, never>;

// ── Helpers ───────────────────────────────────────────────────────────────────

type RawEntry = {
  id: string;
  label: string;
  shell: string;
  cwd: string | null;
  running: boolean;
  exitCode?: number | null;
  createdAt: string;
  outputBytes: number;
};

function deriveShellFamily(shell: string): ShellFamily {
  const s = shell.toLowerCase().replace(/\\/g, '/');
  if (s.includes('pwsh') || s.includes('powershell')) return 'powershell';
  if (s.includes('cmd'))                              return 'cmd';
  if (s.includes('zsh'))                              return 'zsh';
  if (s.includes('fish'))                             return 'fish';
  if (s.includes('bash') || s.includes('sh') || s.includes('wsl')) return 'bash';
  return 'unknown';
}

function mapEntry(raw: RawEntry): TerminalEntry {
  return {
    id:          raw.id,
    label:       raw.label,
    shell:       raw.shell,
    shellFamily: deriveShellFamily(raw.shell),
    cwd:         raw.cwd ?? null,
    running:     raw.running,
    exitCode:    raw.exitCode ?? undefined,
    createdAt:   raw.createdAt,
    outputBytes: raw.outputBytes,
  };
}

// ── IPC adapter factory ───────────────────────────────────────────────────────

/**
 * Creates a `TerminalManagerAdapter` that communicates with the Agent SDK
 * backend over Electron IPC instead of HTTP.
 *
 * Requires `window.electronAPI.invoke` to be available.
 *
 * @example
 * ```ts
 * const adapter = createIpcTerminalAdapter();
 * const agent   = createAgentClient({ handler, terminalAdapter: adapter });
 * ```
 */
export function createIpcTerminalAdapter(
  _config?: IpcTerminalAdapterConfig,
): TerminalManagerAdapter {
  const invoke = window.electronAPI?.invoke;
  const onEvent = window.electronAPI?.on;
  if (!invoke) {
    throw new Error('createIpcTerminalAdapter: window.electronAPI.invoke is not available');
  }

  return {
    async listTerminals(_opts: { sessionId: string }) {
      const raw = await invoke('terminals:list');
      return (raw as RawEntry[]).map(mapEntry);
    },

    async listShells() {
      const raw = await invoke('terminals:shells');
      return raw as AvailableShell[];
    },

    async createTerminal({ label, shell, cwd }: { label?: string; shell?: string; cwd?: string; sessionId: string } = {} as never) {
      const raw = await invoke('terminals:create', { label, shell, cwd }) as RawEntry;
      return mapEntry(raw);
    },

    async removeTerminal(id, _sessionId) {
      await invoke('terminals:remove', { id });
    },

    async sendInput(id, text, _sessionId) {
      await invoke('terminals:sendInput', { id, text });
    },

    async readOutput(id, fromOffset, _sessionId): Promise<TerminalOutput> {
      const raw = await invoke('terminals:readOutput', { id, fromOffset }) as TerminalOutput;
      return raw;
    },

    async resizePty(id, cols, rows, _sessionId) {
      await invoke('terminals:resize', { id, cols, rows });
    },

    streamOutput(id, onData, _sessionId) {
      let stopped = false;
      let unsubOutput: (() => void) | null = null;
      let unsubDone: (() => void) | null = null;

      // Start the stream in the main process
      invoke('terminals:streamStart', { id }).catch(() => {
        stopped = true;
      });

      // Listen for output chunks from main process
      if (onEvent) {
        unsubOutput = onEvent(`terminal:output:${id}`, ((text: string) => {
          if (!stopped) onData(text, false);
        }) as (...args: unknown[]) => void);

        unsubDone = onEvent(`terminal:done:${id}`, ((exitCode: number | null) => {
          if (!stopped) {
            onData('', true, exitCode ?? undefined);
            stopped = true;
          }
        }) as (...args: unknown[]) => void);
      }

      return () => {
        stopped = true;
        if (unsubOutput) unsubOutput();
        if (unsubDone) unsubDone();
        invoke('terminals:streamStop', { id }).catch(() => {});
      };
    },
  };
}
