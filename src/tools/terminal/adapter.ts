import type {
  TerminalEntry,
  TerminalOutput,
  TerminalManagerAdapter,
  HttpTerminalAdapterConfig,
  ShellFamily,
  AvailableShell,
} from './types';

// ── Internal raw entry shape from the backend ─────────────────────────────────

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

// ── HTTP adapter factory ───────────────────────────────────────────────────────

/**
 * Creates a `TerminalManagerAdapter` that communicates with the Agent SDK
 * backend over HTTP REST and SSE.
 *
 * @example
 * ```ts
 * const adapter = createHttpTerminalAdapter({ baseUrl: '/api' });
 * const agent   = createAgentClient({ handler, terminalAdapter: adapter });
 * ```
 */
export function createHttpTerminalAdapter(
  config?: HttpTerminalAdapterConfig,
): TerminalManagerAdapter {
  const base = (config?.baseUrl ?? '/api').replace(/\/$/, '');

  async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  return {
    async listTerminals(_opts: { sessionId: string }) {
      const raw = await apiFetch<{ terminals: RawEntry[] }>('/terminals');
      return raw.terminals.map(mapEntry);
    },

    async listShells() {
      const raw = await apiFetch<{ shells: AvailableShell[] }>('/terminals/shells');
      return raw.shells;
    },

    async createTerminal({ label, shell, cwd }: { label?: string; shell?: string; cwd?: string; sessionId: string } = {} as never) {
      const raw = await apiFetch<RawEntry>('/terminals', {
        method: 'POST',
        body:   JSON.stringify({ label, shell, cwd }),
      });
      return mapEntry(raw);
    },

    async removeTerminal(id, _sessionId) {
      await apiFetch(`/terminals/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    async sendInput(id, text, _sessionId) {
      await apiFetch(`/terminals/${encodeURIComponent(id)}/input`, {
        method: 'POST',
        body:   JSON.stringify({ input: text }),
      });
    },

    async readOutput(id, fromOffset, _sessionId): Promise<TerminalOutput> {
      const raw = await apiFetch<{
        output: string;
        offset: number;
        running: boolean;
        exitCode?: number | null;
      }>(`/terminals/${encodeURIComponent(id)}/output?offset=${fromOffset}`);
      return {
        output:   raw.output,
        offset:   raw.offset,
        running:  raw.running,
        exitCode: raw.exitCode ?? undefined,
      };
    },

    streamOutput(id, onData, _sessionId) {
      const url = `${base}/terminals/${encodeURIComponent(id)}/stream`;
      let es: EventSource | null = null;
      let stopped = false;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      // Track chars already delivered so reconnects can skip duplicate history.
      let receivedChars = 0;

      function connect() {
        if (stopped) return;
        let skipRemaining = receivedChars;

        es = new EventSource(url);

        es.addEventListener('output', (e: MessageEvent<string>) => {
          try {
            const msg = JSON.parse(e.data) as { output: string };
            if (!msg.output) return;
            if (skipRemaining > 0) {
              if (msg.output.length <= skipRemaining) {
                skipRemaining -= msg.output.length;
                return;
              }
              const deduped = msg.output.slice(skipRemaining);
              skipRemaining = 0;
              receivedChars += deduped.length;
              onData(deduped, false);
              return;
            }
            receivedChars += msg.output.length;
            onData(msg.output, false);
          } catch {
            // malformed event — ignore
          }
        });

        es.addEventListener('done', (e: MessageEvent<string>) => {
          stopped = true;
          try {
            const msg = JSON.parse(e.data) as { exitCode?: number };
            onData('', true, msg.exitCode);
          } catch {
            onData('', true, undefined);
          }
          es?.close();
        });

        es.onerror = () => {
          es?.close();
          if (stopped) return;
          // Network disruption ≠ shell exit — retry after 1.5 s.
          retryTimer = setTimeout(connect, 1500);
        };
      }

      connect();

      return () => {
        stopped = true;
        if (retryTimer !== null) clearTimeout(retryTimer);
        es?.close();
      };
    },

    async resizePty(id, cols, rows, _sessionId) {
      await apiFetch(`/terminals/${encodeURIComponent(id)}/resize`, {
        method: 'POST',
        body:   JSON.stringify({ cols, rows }),
      });
    },
  };
}
