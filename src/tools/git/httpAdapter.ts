import type {
  GitAdapter,
  GitStatusResult,
  GitDiffResult,
  GitLogEntry,
  GitCommitResult,
} from './adapter';

// ── Config ────────────────────────────────────────────────────────────────────

export type HttpGitAdapterConfig = {
  /**
   * Base URL prefix for the agent-sdk backend API.
   * Defaults to `'/api'`.
   */
  baseUrl?: string;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createHttpGitAdapter(config: HttpGitAdapterConfig = {}): GitAdapter {
  const base = (config.baseUrl ?? '/api').replace(/\/$/, '');

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
    status() {
      return apiFetch<GitStatusResult>('/git/status');
    },

    diff({ staged = false, paths = [] } = {}) {
      const params = new URLSearchParams();
      if (staged) params.set('staged', 'true');
      if (paths.length) params.set('paths', paths.join(','));
      const qs = params.toString();
      return apiFetch<GitDiffResult>(`/git/diff${qs ? `?${qs}` : ''}`);
    },

    log(limit = 10) {
      return apiFetch<{ entries: GitLogEntry[] }>(`/git/log?limit=${limit}`);
    },

    stage(paths) {
      return apiFetch<{ staged: string[] }>('/git/stage', {
        method: 'POST',
        body: JSON.stringify({ paths: paths ?? [] }),
      });
    },

    unstage(paths) {
      return apiFetch<{ unstaged: string[] }>('/git/unstage', {
        method: 'POST',
        body: JSON.stringify({ paths: paths ?? [] }),
      });
    },

    commit(message) {
      return apiFetch<GitCommitResult>('/git/commit', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
    },

    discard(paths) {
      return apiFetch<{ discarded: string[] }>('/git/discard', {
        method: 'POST',
        body: JSON.stringify({ paths }),
      });
    },
  };
}
