/**
 * Tests for the git toolset SDK layer:
 *   src/tools/git/tools.ts       (createGitTools)
 *   src/tools/git/toolSet.ts     (createGitToolSet)
 *   src/tools/git/httpAdapter.ts (createHttpGitAdapter)
 *
 * All external adapters are mocked; no network or filesystem calls are made.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGitTools } from '../../tools/git/tools';
import { createGitToolSet } from '../../tools/git/toolSet';
import { createHttpGitAdapter } from '../../tools/git/httpAdapter';
import type { GitAdapter, GitStatusResult, GitDiffResult, GitLogEntry, GitCommitResult } from '../../tools/git/adapter';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const ctx = {
  sessionId:      'sess',
  agentName:      'main',
  conversationId: 'main',
};

function makeAdapter(overrides: Partial<GitAdapter> = {}): GitAdapter {
  return {
    status:  vi.fn<() => Promise<GitStatusResult>>().mockResolvedValue({ staged: [], unstaged: [], untracked: [] }),
    diff:    vi.fn<(opts?: { staged?: boolean; paths?: string[] }) => Promise<GitDiffResult>>().mockResolvedValue({ output: '' }),
    log:     vi.fn<(limit?: number) => Promise<{ entries: GitLogEntry[] }>>().mockResolvedValue({ entries: [] }),
    stage:   vi.fn<(paths?: string[]) => Promise<{ staged: string[] }>>().mockResolvedValue({ staged: [] }),
    unstage: vi.fn<(paths?: string[]) => Promise<{ unstaged: string[] }>>().mockResolvedValue({ unstaged: [] }),
    commit:  vi.fn<(message: string) => Promise<GitCommitResult>>().mockResolvedValue({ hash: 'abc1234', subject: 'test' }),
    discard: vi.fn<(paths: string[]) => Promise<{ discarded: string[] }>>().mockResolvedValue({ discarded: [] }),
    ...overrides,
  };
}

function makeSdkCtx() {
  return {
    ...ctx,
    signal: new AbortController().signal,
  } as unknown as Parameters<ReturnType<typeof createGitTools>['tools'][number]['execute']>[1];
}

// ═══════════════════════════════════════════════════════════════════════════════
// createGitTools — tool list
// ═══════════════════════════════════════════════════════════════════════════════

describe('createGitTools', () => {
  it('returns an object with a tools array and getSystemPrompt function', () => {
    const { tools, getSystemPrompt } = createGitTools(makeAdapter());
    expect(Array.isArray(tools)).toBe(true);
    expect(typeof getSystemPrompt).toBe('function');
  });

  it('exposes all 7 git tools', () => {
    const { tools } = createGitTools(makeAdapter());
    const names = tools.map(t => t.name);
    expect(names).toContain('git_status');
    expect(names).toContain('git_diff');
    expect(names).toContain('git_log');
    expect(names).toContain('git_stage');
    expect(names).toContain('git_unstage');
    expect(names).toContain('git_commit');
    expect(names).toContain('git_discard');
    expect(tools).toHaveLength(7);
  });

  it('all tools belong to group "Git"', () => {
    const { tools } = createGitTools(makeAdapter());
    for (const t of tools) {
      expect(t.group).toBe('Git');
    }
  });

  it('getSystemPrompt returns a non-empty string', () => {
    const { getSystemPrompt } = createGitTools(makeAdapter());
    const prompt = getSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('git_status');
    expect(prompt).toContain('git_commit');
    expect(prompt).toContain('git_discard');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// git_status
// ═══════════════════════════════════════════════════════════════════════════════

describe('git_status', () => {
  it('calls adapter.status() and returns the result', async () => {
    const adapter = makeAdapter({
      status: vi.fn().mockResolvedValue({
        staged: [{ path: 'src/foo.ts', status: 'M' }],
        unstaged: [],
        untracked: [],
      }),
    });
    const { tools } = createGitTools(adapter);
    const gitStatus = tools.find(t => t.name === 'git_status')!;

    const result = await gitStatus.execute({}, makeSdkCtx()) as GitStatusResult;
    expect(adapter.status).toHaveBeenCalledOnce();
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0].path).toBe('src/foo.ts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// git_diff
// ═══════════════════════════════════════════════════════════════════════════════

describe('git_diff', () => {
  it('calls adapter.diff with default params', async () => {
    const adapter = makeAdapter();
    const { tools } = createGitTools(adapter);
    const gitDiff = tools.find(t => t.name === 'git_diff')!;

    await gitDiff.execute({}, makeSdkCtx());
    expect(adapter.diff).toHaveBeenCalledWith({ staged: undefined, paths: undefined });
  });

  it('passes staged=true and paths to adapter', async () => {
    const adapter = makeAdapter();
    const { tools } = createGitTools(adapter);
    const gitDiff = tools.find(t => t.name === 'git_diff')!;

    await gitDiff.execute({ staged: true, paths: ['src/foo.ts'] }, makeSdkCtx());
    expect(adapter.diff).toHaveBeenCalledWith({ staged: true, paths: ['src/foo.ts'] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// git_log
// ═══════════════════════════════════════════════════════════════════════════════

describe('git_log', () => {
  it('calls adapter.log with the limit param', async () => {
    const adapter = makeAdapter();
    const { tools } = createGitTools(adapter);
    const gitLog = tools.find(t => t.name === 'git_log')!;

    await gitLog.execute({ limit: 25 }, makeSdkCtx());
    expect(adapter.log).toHaveBeenCalledWith(25);
  });

  it('calls adapter.log with undefined when limit is omitted', async () => {
    const adapter = makeAdapter();
    const { tools } = createGitTools(adapter);
    const gitLog = tools.find(t => t.name === 'git_log')!;

    await gitLog.execute({}, makeSdkCtx());
    expect(adapter.log).toHaveBeenCalledWith(undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// git_stage
// ═══════════════════════════════════════════════════════════════════════════════

describe('git_stage', () => {
  it('calls adapter.stage with provided paths', async () => {
    const adapter = makeAdapter({
      stage: vi.fn().mockResolvedValue({ staged: ['src/foo.ts'] }),
    });
    const { tools } = createGitTools(adapter);
    const gitStage = tools.find(t => t.name === 'git_stage')!;

    const result = await gitStage.execute({ paths: ['src/foo.ts'] }, makeSdkCtx()) as { staged: string[] };
    expect(adapter.stage).toHaveBeenCalledWith(['src/foo.ts']);
    expect(result.staged).toContain('src/foo.ts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// git_unstage
// ═══════════════════════════════════════════════════════════════════════════════

describe('git_unstage', () => {
  it('calls adapter.unstage with provided paths', async () => {
    const adapter = makeAdapter({
      unstage: vi.fn().mockResolvedValue({ unstaged: ['a.ts'] }),
    });
    const { tools } = createGitTools(adapter);
    const gitUnstage = tools.find(t => t.name === 'git_unstage')!;

    const result = await gitUnstage.execute({ paths: ['a.ts'] }, makeSdkCtx()) as { unstaged: string[] };
    expect(adapter.unstage).toHaveBeenCalledWith(['a.ts']);
    expect(result.unstaged).toContain('a.ts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// git_commit
// ═══════════════════════════════════════════════════════════════════════════════

describe('git_commit', () => {
  it('calls adapter.commit with the message', async () => {
    const adapter = makeAdapter();
    const { tools } = createGitTools(adapter);
    const gitCommit = tools.find(t => t.name === 'git_commit')!;

    const result = await gitCommit.execute({ message: 'feat: my feature' }, makeSdkCtx()) as GitCommitResult;
    expect(adapter.commit).toHaveBeenCalledWith('feat: my feature');
    expect(result.hash).toBe('abc1234');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// git_discard
// ═══════════════════════════════════════════════════════════════════════════════

describe('git_discard', () => {
  it('calls adapter.discard with required paths', async () => {
    const adapter = makeAdapter({
      discard: vi.fn().mockResolvedValue({ discarded: ['a.ts', 'b.ts'] }),
    });
    const { tools } = createGitTools(adapter);
    const gitDiscard = tools.find(t => t.name === 'git_discard')!;

    const result = await gitDiscard.execute({ paths: ['a.ts', 'b.ts'] }, makeSdkCtx()) as { discarded: string[] };
    expect(adapter.discard).toHaveBeenCalledWith(['a.ts', 'b.ts']);
    expect(result.discarded).toContain('a.ts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createGitToolSet
// ═══════════════════════════════════════════════════════════════════════════════

describe('createGitToolSet', () => {
  it('has name "git"', () => {
    const toolSet = createGitToolSet(makeAdapter());
    expect(toolSet.name).toBe('git');
  });

  it('has a non-empty description', () => {
    const toolSet = createGitToolSet(makeAdapter());
    expect(typeof toolSet.description).toBe('string');
    expect(toolSet.description!.length).toBeGreaterThan(0);
  });

  it('exposes 7 tools', () => {
    const toolSet = createGitToolSet(makeAdapter());
    expect(toolSet.tools).toHaveLength(7);
  });

  it('onGetSystemPrompt returns the git guidance string', () => {
    const toolSet = createGitToolSet(makeAdapter());
    const promptCtx = { userMessage: '', baseSystemPrompt: '', currentSystemPromptParts: [], suppressToolSetPrompt: () => {} };
    const prompt = toolSet.onGetSystemPrompt?.({ sessionId: 'sess', agentName: 'main', conversationId: 'main' } as any, promptCtx, [toolSet]);
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('git_status');
    expect(prompt).toContain('git_discard');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createHttpGitAdapter
// ═══════════════════════════════════════════════════════════════════════════════

describe('createHttpGitAdapter', () => {
  let fetchMock: typeof globalThis.fetch;

  function mockFetchOk(data: unknown) {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
      status: 200,
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchMock;
  }

  function mockFetchFail(errorBody: unknown = { error: 'Something went wrong' }, status = 500) {
    fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Error',
      json: () => Promise.resolve(errorBody),
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchMock;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── status ──────────────────────────────────────────────────────────────────

  it('status calls GET /api/git/status', async () => {
    mockFetchOk({ staged: [], unstaged: [], untracked: [] });
    const adapter = createHttpGitAdapter();
    const result = await adapter.status();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/git/status',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result.staged).toEqual([]);
  });

  it('status throws when response is not ok', async () => {
    mockFetchFail({ error: 'not ready' });
    const adapter = createHttpGitAdapter();
    await expect(adapter.status()).rejects.toThrow('not ready');
  });

  // ── diff ────────────────────────────────────────────────────────────────────

  it('diff calls GET /api/git/diff without query params by default', async () => {
    mockFetchOk({ output: '' });
    const adapter = createHttpGitAdapter();
    await adapter.diff();
    const url = vi.mocked(fetchMock).mock.calls[0][0] as string;
    expect(url).toBe('/api/git/diff');
  });

  it('diff includes staged=true and paths as query params', async () => {
    mockFetchOk({ output: 'diff output' });
    const adapter = createHttpGitAdapter();
    await adapter.diff({ staged: true, paths: ['src/foo.ts', 'src/bar.ts'] });
    const url = vi.mocked(fetchMock).mock.calls[0][0] as string;
    expect(url).toContain('staged=true');
    expect(url).toContain('paths=');
    expect(url).toContain('src%2Ffoo.ts');
  });

  it('diff throws when response is not ok', async () => {
    mockFetchFail({ error: 'path error' });
    const adapter = createHttpGitAdapter();
    await expect(adapter.diff()).rejects.toThrow('path error');
  });

  // ── log ─────────────────────────────────────────────────────────────────────

  it('log calls GET /api/git/log?limit=N', async () => {
    mockFetchOk({ entries: [] });
    const adapter = createHttpGitAdapter();
    await adapter.log(25);
    const url = vi.mocked(fetchMock).mock.calls[0][0] as string;
    expect(url).toContain('limit=25');
  });

  it('log defaults to limit=10', async () => {
    mockFetchOk({ entries: [] });
    const adapter = createHttpGitAdapter();
    await adapter.log();
    const url = vi.mocked(fetchMock).mock.calls[0][0] as string;
    expect(url).toContain('limit=10');
  });

  // ── stage ────────────────────────────────────────────────────────────────────

  it('stage calls POST /api/git/stage with paths in body', async () => {
    mockFetchOk({ staged: ['a.ts'] });
    const adapter = createHttpGitAdapter();
    await adapter.stage(['a.ts']);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/git/stage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paths: ['a.ts'] }),
      }),
    );
  });

  it('stage with undefined paths sends empty array', async () => {
    mockFetchOk({ staged: [] });
    const adapter = createHttpGitAdapter();
    await adapter.stage(undefined);
    const body = JSON.parse((vi.mocked(fetchMock).mock.calls[0][1] as RequestInit).body as string);
    expect(body.paths).toEqual([]);
  });

  // ── unstage ──────────────────────────────────────────────────────────────────

  it('unstage calls POST /api/git/unstage with paths', async () => {
    mockFetchOk({ unstaged: ['b.ts'] });
    const adapter = createHttpGitAdapter();
    await adapter.unstage(['b.ts']);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/git/unstage',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((vi.mocked(fetchMock).mock.calls[0][1] as RequestInit).body as string);
    expect(body.paths).toEqual(['b.ts']);
  });

  // ── commit ────────────────────────────────────────────────────────────────────

  it('commit calls POST /api/git/commit with message', async () => {
    mockFetchOk({ hash: 'abc1234', subject: 'feat: thing' });
    const adapter = createHttpGitAdapter();
    const result = await adapter.commit('feat: thing');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/git/commit',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((vi.mocked(fetchMock).mock.calls[0][1] as RequestInit).body as string);
    expect(body.message).toBe('feat: thing');
    expect(result.hash).toBe('abc1234');
  });

  // ── discard ──────────────────────────────────────────────────────────────────

  it('discard calls POST /api/git/discard with paths', async () => {
    mockFetchOk({ discarded: ['a.ts'] });
    const adapter = createHttpGitAdapter();
    await adapter.discard(['a.ts']);
    const body = JSON.parse((vi.mocked(fetchMock).mock.calls[0][1] as RequestInit).body as string);
    expect(body.paths).toEqual(['a.ts']);
  });

  // ── custom baseUrl ────────────────────────────────────────────────────────────

  it('uses a custom baseUrl and strips trailing slash', async () => {
    mockFetchOk({ staged: [], unstaged: [], untracked: [] });
    const adapter = createHttpGitAdapter({ baseUrl: 'http://localhost:3000/api/' });
    await adapter.status();
    const url = vi.mocked(fetchMock).mock.calls[0][0] as string;
    expect(url).toBe('http://localhost:3000/api/git/status');
  });

  // ── error handling ───────────────────────────────────────────────────────────

  it('throws using statusText when error body has no error field', async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({}),
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchMock;
    const adapter = createHttpGitAdapter();
    await expect(adapter.status()).rejects.toThrow('Not Found');
  });

  it('throws when error body json parse fails', async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('bad json')),
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchMock;
    const adapter = createHttpGitAdapter();
    await expect(adapter.status()).rejects.toThrow('Internal Server Error');
  });
});
