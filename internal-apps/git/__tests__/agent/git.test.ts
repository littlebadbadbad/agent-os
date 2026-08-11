/**
 * Tests for the git extension agent layer:
 *   extensions/git/agent/tools.ts       (createGitTools)
 *   extensions/git/agent/toolSet.ts     (createGitToolSet)
 *
 * All external adapters are mocked; no network or filesystem calls are made.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGitTools } from '../../agent/tools';
import { createGitToolSet } from '../../agent/toolSet';
import type { GitAdapter, GitStatusResult, GitDiffResult, GitLogEntry, GitCommitResult } from '../../agent/types';

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
    const tsTools = typeof toolSet.tools === 'function' ? toolSet.tools() : toolSet.tools;
    expect(tsTools).toHaveLength(7);
  });

  it('onGetSystemPrompt returns the git guidance string', () => {
    const toolSet = createGitToolSet(makeAdapter());
    const promptCtx = { userMessage: '', baseSystemPrompt: '', currentSystemPromptParts: [], suppressToolSetPrompt: () => {} };
    const prompt = toolSet.onGetSystemPrompt?.({ sessionId: 'sess', agentName: 'main', conversationId: 'main' } as any, promptCtx as any);
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('git_status');
    expect(prompt).toContain('git_discard');
  });
});
