/**
 * extensions/terminal/agent/shell/pluginAdapter.ts — Terminal plugin adapter
 *
 * Implements TerminalManagerAdapter using a pre-bound PluginApiClient.
 * ALL communication — RPC calls and streaming — goes through host.apiClient.
 * This is the same pattern as browser's createBrowserPluginAdapter.
 *
 * No classes, no direct HTTP/SSE — pure PluginApiClient delegation.
 *
 * Moved from agent/pluginAdapter.ts during plugin restructuring (Phase 1).
 */

import type { PluginApiClient } from '@agent-type';
import type {
  TerminalEntry,
  TerminalOutput,
  TerminalManagerAdapter,
  ShellFamily,
  WaitResult,
} from './types';

// ── Internal raw shapes ───────────────────────────────────────────────────────

interface RawEntry {
  id: string;
  label: string;
  shell: string;
  cwd: string | null;
  running: boolean;
  exitCode?: number | null;
  createdAt: string;
  outputBytes: number;
}

interface StreamChunk {
  output?: string;
  type?: 'done';
  exitCode?: number;
}

function isStreamChunk(value: object): value is StreamChunk {
  return 'output' in value || 'type' in value;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a TerminalManagerAdapter that communicates via a pre-bound
 * PluginApiClient.  Matches the browser plugin adapter pattern exactly:
 *
 *   - RPC methods   → apiClient.call(method, params)
 *   - Streaming      → apiClient.connectStream(streamName, params)
 *
 * @param apiClient  Pre-bound PluginApiClient for the 'terminal' plugin.
 */
export function createTerminalPluginAdapter(
  apiClient: PluginApiClient,
): TerminalManagerAdapter {
  // ── Per-terminal stream deduplication ──────────────────────────────────
  // Prevents duplicate PTY subscriptions when React StrictMode causes
  // double mounting in development. Tracks one active stream per terminal
  // id and automatically terminates any prior stream before starting a new
  // one, eliminating the race between disconnect-backend and connect-backend.
  const activeStreams = new Map<string, () => void>();

  return {
    async listTerminals(_opts: { sessionId: string }) {
      const res = await apiClient.call<{ terminals: RawEntry[] }>('list');
      return res.terminals.map(mapEntry);
    },

    async listShells() {
      interface RawShell { name: string; path: string; isDefault: boolean }
      const res = await apiClient.call<{ shells: RawShell[] }>('shells');
      return res.shells;
    },

    async createTerminal(opts: { label?: string; shell?: string; cwd?: string; sessionId: string }) {
      const raw = await apiClient.call<RawEntry>('create', {
        label: opts.label,
        shell: opts.shell,
        cwd: opts.cwd,
      });
      return mapEntry(raw);
    },

    async removeTerminal(id: string, _sessionId: string) {
      await apiClient.call('remove', { id });
    },

    async sendInput(id: string, text: string, _sessionId: string) {
      await apiClient.call('sendInput', { id, text });
    },

    async readOutput(id: string, fromOffset: number, _sessionId: string): Promise<TerminalOutput> {
      const raw = await apiClient.call<{
        output: string;
        offset: number;
        running: boolean;
        exitCode?: number | null;
      }>('readOutput', { id, fromOffset });
      return {
        output:   raw.output,
        offset:   raw.offset,
        running:  raw.running,
        exitCode: raw.exitCode ?? undefined,
      };
    },

    async resizePty(id: string, cols: number, rows: number, _sessionId: string) {
      await apiClient.call('resize', { id, cols, rows });
    },

    async waitTerminal(
      id: string,
      opts: { idleMs?: number; timeoutMs?: number },
      _sessionId: string,
    ): Promise<WaitResult> {
      return apiClient.call<WaitResult>('wait', { id, ...opts });
    },

    async cancelWait(id: string, _sessionId: string) {
      await apiClient.call('cancelWait', { id });
    },

    async sleepTerminal(durationMs: number, _sessionId: string) {
      return apiClient.call<{ slept: number; aborted: boolean }>('sleep', { durationMs });
    },

    streamOutput(
      id: string,
      onData: (chunk: string, done: boolean, exitCode?: number) => void,
      _sessionId: string,
    ): () => void {
      // Terminate any existing stream for this terminal id before creating a
      // new one.  This closes the window where a stale backend connection from
      // a previous mount (e.g. React StrictMode double-effect) is still
      // pushing data through the IPC channel.
      const prior = activeStreams.get(id);
      if (prior) {
        try { prior(); } catch {}
        activeStreams.delete(id);
      }

      const client = apiClient.connectStream('stream', { id });

      // Bridge: backend pushes { output, type?, exitCode? } chunks.
      client.callbacks.onData = (chunk: unknown) => {
        if (typeof chunk !== 'object' || chunk === null) return;
        if (!isStreamChunk(chunk)) return;
        if (chunk.type === 'done') {
          onData('', true, chunk.exitCode);
          return;
        }
        if (typeof chunk.output === 'string') {
          onData(chunk.output, false);
        }
      };

      client.callbacks.onError = () => {
        onData('', true);
      };

      const sub = client.subscribe();

      const cleanup = () => {
        sub.unsubscribe();
        client.callbacks.onEnd();
        if (activeStreams.get(id) === cleanup) {
          activeStreams.delete(id);
        }
      };

      activeStreams.set(id, cleanup);
      return cleanup;
    },
  };
}

/** Alias — UI iframe uses the same factory as the agent side. */
export const createTerminalUiAdapter = createTerminalPluginAdapter;
