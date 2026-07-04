import type { FileAdapter, HttpFileAdapterConfig } from './types';

// ── URL builder ───────────────────────────────────────────────────────────────

function buildUrl(
  base: string,
  endpoint: string,
  params?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${base}${endpoint}`, globalThis.location?.href);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

// ── HTTP fetch helper ─────────────────────────────────────────────────────────

async function httpFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json();
  if (!res.ok) {
    const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

// ── HTTP adapter factory ──────────────────────────────────────────────────────

/**
 * Create a `FileAdapter` that calls the agent-sdk backend REST API.
 *
 * This is the default adapter for browser → Node.js deployments.
 *
 * @example
 * ```ts
 * const adapter = defaultHttpFileAdapter({ baseUrl: '/api' });
 * const fileTools = createFileTools(adapter);
 * ```
 */
export function defaultHttpFileAdapter(
  config: HttpFileAdapterConfig = {},
): FileAdapter {
  const base = (config.baseUrl ?? '/api').replace(/\/$/, '');
  const json = { 'Content-Type': 'application/json' };

  return {
    readFile: ({ path, startLine, endLine }) =>
      httpFetch(buildUrl(base, '/api/files/read', { path, startLine, endLine })),

    writeFile: ({ path, content }) =>
      typeof content === 'object' && content.source === 'data'
        ? httpFetch(buildUrl(base, '/api/files/write'), {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ path, attachment: { source: content.source, mimeType: content.mimeType, data: content.data } }),
          })
        : httpFetch(buildUrl(base, '/api/files/write'), {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ path, content }),
          }),

    strReplace: ({ path, oldStr, newStr }) =>
      httpFetch(buildUrl(base, '/api/files/str-replace'), {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ path, oldStr, newStr }),
      }),

    replaceAll: ({ path, oldStr, newStr }) =>
      httpFetch(buildUrl(base, '/api/files/replace-all'), {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ path, oldStr, newStr }),
      }),

    deleteFile: ({ path }) =>
      httpFetch(buildUrl(base, '/api/files/delete', { path }), { method: 'DELETE' }),

    moveFile: ({ from, to }) =>
      httpFetch(buildUrl(base, '/api/files/move'), {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ from, to }),
      }),

    listDir: ({ path, depth } = {} as never) =>
      httpFetch(buildUrl(base, '/api/files/list', { path, depth })),

    searchFiles: ({ pattern, content, maxResults, caseSensitive, contextLines, outputMode }) =>
      httpFetch(
        buildUrl(base, '/api/files/search', {
          pattern,
          content,
          max: maxResults,
          caseSensitive: caseSensitive !== undefined ? String(caseSensitive) : undefined,
          contextLines,
          outputMode,
        }),
      ),

    getWorkspaceRoot: () =>
      httpFetch(buildUrl(base, '/api/files/workspace')),

    setWorkspaceRoot: ({ path }) =>
      httpFetch(buildUrl(base, '/api/files/workspace'), {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ path }),
      }),
  };
}
