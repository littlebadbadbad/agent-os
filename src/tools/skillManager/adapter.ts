import type { BackendSkill, SkillManagerAdapter, HttpSkillAdapterConfig } from './types';

// ── HTTP fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

// ── HTTP adapter factory ──────────────────────────────────────────────────────

/**
 * Create a `SkillManagerAdapter` that talks to the Agent SDK backend REST API.
 *
 * Routes used:
 *   GET    /skills                    — list all installed skills
 *   POST   /skills                    — install from URL or raw markdown
 *   DELETE /skills/:name              — remove a skill
 *   GET    /skills/:name/file?path=…  — read a file inside a skill directory
 *
 * @example
 * ```ts
 * const adapter = createHttpSkillAdapter({ baseUrl: '/api' });
 * const { syncSkills, tools } = createSkillManager(agents, adapter);
 * ```
 */
export function createHttpSkillAdapter(
  config: HttpSkillAdapterConfig = {},
): SkillManagerAdapter {
  const base = (config.baseUrl ?? '/api').replace(/\/$/, '');

  return {
    async listSkills() {
      const data = await apiFetch<{ skills: BackendSkill[] }>(`${base}/skills`);
      return data.skills ?? [];
    },

    async installSkill({ url, name, content }) {
      return apiFetch<{ installed: string; message: string }>(`${base}/skills`, {
        method: 'POST',
        body: JSON.stringify({ url, name, content }),
      });
    },

    async removeSkill(name) {
      return apiFetch<{ deleted: string }>(
        `${base}/skills/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      );
    },

    async readSkillFile(skill, path) {
      return apiFetch<{ content: string; path: string }>(
        `${base}/skills/${encodeURIComponent(skill)}/file?path=${encodeURIComponent(path)}`,
      );
    },
  };
}
