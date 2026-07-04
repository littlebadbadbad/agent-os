/**
 * Tests for the upgrade toolset SDK layer:
 *   src/tools/upgrade/store.ts
 *   src/tools/upgrade/tools.ts           (createUpgradeTools)
 *   src/tools/upgrade/toolSet.ts         (createUpgradeToolSet)
 *   src/tools/upgrade/httpAdapter.ts     (createHttpUpgradeAdapter)
 *
 * All external adapters are mocked; no network or filesystem calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { upgradeStore } from '../../tools/upgrade/store';
import { createUpgradeTools } from '../../tools/upgrade/tools';
import { createUpgradeToolSet } from '../../tools/upgrade/toolSet';
import { createHttpUpgradeAdapter } from '../../tools/upgrade/httpAdapter';
import type { UpgradeAdapter, VersionInfo, BuildResult, TerminalSnapshot, DevStartResult, TestResult } from '../../tools/upgrade/adapter';
import type { ToolSetContext, SystemPromptContext } from '@agent-type';
import type { Tool } from '@agent-type';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SESSION = 'test-session';

/** Context where conversationId === "main" → toolSetContextKey returns sessionId */
const ctx = {
  sessionId:      SESSION,
  agentName:      'main',
  conversationId: 'main',
};

function makeAdapter(overrides: Partial<UpgradeAdapter> = {}): UpgradeAdapter {
  return {
    getVersion: vi.fn<() => Promise<VersionInfo>>().mockResolvedValue({ version: '1.0.0' }),
    build:      vi.fn<() => Promise<BuildResult>>().mockResolvedValue({ terminalId: 'term_build' }),
    readTerminalOutput: vi.fn<(id: string, offset: number) => Promise<TerminalSnapshot>>().mockResolvedValue(
      { output: 'build output', offset: 20, running: false, exitCode: 0 },
    ),
    sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    restart:    vi.fn().mockResolvedValue(undefined),
    devStart:   vi.fn<() => Promise<DevStartResult>>().mockResolvedValue({ url: 'http://localhost:5173', alreadyRunning: false, terminalId: 'term_test' }),
    devStop:    vi.fn().mockResolvedValue(undefined),
    devStatus:  vi.fn().mockResolvedValue({ running: false }),
    runTests:   vi.fn<(opts: { target: 'backend' | 'sdk' | 'typecheck'; args?: string[]; terminalId?: string }) => Promise<TestResult>>().mockResolvedValue({ started: true, terminalId: 'term_test' }),
    confirm:    vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeSdkCtx(overrides: Partial<ToolSetContext & { signal?: AbortSignal; requestUserInput?: unknown }> = {}) {
  return {
    ...ctx,
    signal: new AbortController().signal,
    ...overrides,
  } as unknown as Parameters<ReturnType<typeof createUpgradeTools>[number]['execute']>[1];
}

beforeEach(() => {
  upgradeStore.remove(SESSION);
});

// ═══════════════════════════════════════════════════════════════════════════════
// upgradeStore
// ═══════════════════════════════════════════════════════════════════════════════

describe('upgradeStore', () => {
  it('returns undefined for an unknown key', () => {
    expect(upgradeStore.get('nonexistent')).toBeUndefined();
  });

  it('creates a bucket on first write', () => {
    upgradeStore.setVersion(SESSION, { version: '1.0.0' });
    expect(upgradeStore.get(SESSION)?.version?.version).toBe('1.0.0');
  });

  it('setVersion notifies subscribers', () => {
    const listener = vi.fn();
    const unsub = upgradeStore.subscribe(SESSION, listener);
    upgradeStore.setVersion(SESSION, { version: '2.0.0' });
    expect(listener).toHaveBeenCalledOnce();
    unsub();
  });

  it('subscribe returns an unsubscribe function that stops notifications', () => {
    const listener = vi.fn();
    const unsub = upgradeStore.subscribe(SESSION, listener);
    unsub();
    upgradeStore.setVersion(SESSION, { version: '3.0.0' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('setDevState stores url and running flag and notifies', () => {
    const listener = vi.fn();
    upgradeStore.subscribe(SESSION, listener);
    upgradeStore.setDevState(SESSION, 'http://localhost:5173', true);
    const b = upgradeStore.get(SESSION);
    expect(b?.devUrl).toBe('http://localhost:5173');
    expect(b?.devRunning).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('setDevState with undefined url marks server stopped', () => {
    upgradeStore.setDevState(SESSION, 'http://localhost:5173', true);
    upgradeStore.setDevState(SESSION, undefined, false);
    const b = upgradeStore.get(SESSION);
    expect(b?.devUrl).toBeUndefined();
    expect(b?.devRunning).toBe(false);
  });

  it('setFrozen sets frozen=true without notifying', () => {
    const listener = vi.fn();
    upgradeStore.subscribe(SESSION, listener);
    upgradeStore.setFrozen(SESSION, true);
    expect(upgradeStore.get(SESSION)?.frozen).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('setRestartPending marks the flag without notifying', () => {
    const listener = vi.fn();
    upgradeStore.subscribe(SESSION, listener);
    upgradeStore.setRestartPending(SESSION, true);
    expect(upgradeStore.get(SESSION)?.restartPending).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('remove deletes the bucket', () => {
    upgradeStore.setVersion(SESSION, { version: '1.0.0' });
    upgradeStore.remove(SESSION);
    expect(upgradeStore.get(SESSION)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createUpgradeTools — individual tool execution
// ═══════════════════════════════════════════════════════════════════════════════

describe('createUpgradeTools', () => {
  it('returns an array with all 7 upgrade tools', () => {
    const tools = createUpgradeTools(makeAdapter());
    const names = tools.map(t => t.name);
    expect(names).toContain('upgrade_get_version');
    expect(names).toContain('upgrade_build');
    expect(names).toContain('upgrade_restart');
    expect(names).toContain('upgrade_dev_start');
    expect(names).toContain('upgrade_dev_stop');
    expect(names).toContain('upgrade_run_tests');
    expect(names).toContain('upgrade_complete');
    expect(tools).toHaveLength(7);
  });

  it('all tools belong to group "Upgrade"', () => {
    const tools = createUpgradeTools(makeAdapter());
    for (const t of tools) {
      expect(t.group).toBe('Upgrade');
    }
  });
});

describe('upgrade_get_version', () => {
  it('calls adapter.getVersion and stores the result in the store', async () => {
    const adapter = makeAdapter();
    const [getVersion] = createUpgradeTools(adapter);
    const sdkCtx = makeSdkCtx();

    const result = await getVersion.execute({}, sdkCtx);
    expect(adapter.getVersion).toHaveBeenCalledOnce();
    expect(result).toEqual({ version: '1.0.0' });
    expect(upgradeStore.get(SESSION)?.version).toEqual({ version: '1.0.0' });
  });
});

describe('upgrade_build', () => {
  it('polls terminal until exit and returns success result', async () => {
    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const build = tools.find(t => t.name === 'upgrade_build')!;

    const result = await build.execute({}, makeSdkCtx()) as Record<string, unknown>;

    expect(adapter.build).toHaveBeenCalledWith({});
    expect(adapter.readTerminalOutput).toHaveBeenCalledWith('term_build', 0);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.version).toBe('1.0.0');
    expect(result.terminalId).toBe('term_build');
    expect(typeof result.hint).toBe('string');
  });

  it('returns waitStopped when context signal is already aborted', async () => {
    const adapter = makeAdapter({
      readTerminalOutput: vi.fn().mockResolvedValue({ output: '', offset: 0, running: true }),
    });
    const tools = createUpgradeTools(adapter);
    const build = tools.find(t => t.name === 'upgrade_build')!;

    const abortController = new AbortController();
    abortController.abort();
    const result = await build.execute(
      {},
      makeSdkCtx({ signal: abortController.signal }),
    ) as Record<string, unknown>;

    expect(result.reason).toBe('aborted');
    expect(result.terminalId).toBe('term_build');
  });

  it('passes terminalId to adapter.build when provided', async () => {
    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const build = tools.find(t => t.name === 'upgrade_build')!;

    await build.execute({ terminalId: 'existing-term' }, makeSdkCtx());
    expect(adapter.build).toHaveBeenCalledWith({ terminalId: 'existing-term' });
  });
});

describe('upgrade_dev_start', () => {
  it('calls adapter.devStart and stores dev state', async () => {
    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const devStart = tools.find(t => t.name === 'upgrade_dev_start')!;

    const result = await devStart.execute({}, makeSdkCtx());
    expect(adapter.devStart).toHaveBeenCalledOnce();
    expect(result).toEqual({
      url: 'http://localhost:5173',
      alreadyRunning: false,
      terminalId: 'term_test',
      hint: 'Dev server terminal opened (id: term_test).',
    });

    const b = upgradeStore.get(SESSION);
    expect(b?.devUrl).toBe('http://localhost:5173');
    expect(b?.devRunning).toBe(true);
    expect(b?.devTerminalId).toBe('term_test');
  });

  it('reflects alreadyRunning=true from adapter', async () => {
    const adapter = makeAdapter({
      devStart: vi.fn().mockResolvedValue({ url: 'http://localhost:5173', alreadyRunning: true }),
    });
    const tools = createUpgradeTools(adapter);
    const devStart = tools.find(t => t.name === 'upgrade_dev_start')!;

    const result = await devStart.execute({}, makeSdkCtx());
    expect((result as DevStartResult).alreadyRunning).toBe(true);
  });
});

describe('upgrade_dev_stop', () => {
  it('calls adapter.devStop and clears dev state in store', async () => {
    // Pre-populate the store with running state
    upgradeStore.setDevState(SESSION, 'http://localhost:5173', true);

    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const devStop = tools.find(t => t.name === 'upgrade_dev_stop')!;

    const result = await devStop.execute({}, makeSdkCtx());
    expect(adapter.devStop).toHaveBeenCalledOnce();
    expect(result).toEqual({ stopped: true });

    const b = upgradeStore.get(SESSION);
    expect(b?.devUrl).toBeUndefined();
    expect(b?.devRunning).toBe(false);
  });
});

describe('upgrade_run_tests', () => {
  it('calls adapter.runTests with correct target and args', async () => {
    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const runTests = tools.find(t => t.name === 'upgrade_run_tests')!;

    await runTests.execute({ target: 'backend', args: ['--coverage'] }, makeSdkCtx());
    expect(adapter.runTests).toHaveBeenCalledWith({ target: 'backend', args: ['--coverage'] });
  });

  it('works for the sdk target', async () => {
    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const runTests = tools.find(t => t.name === 'upgrade_run_tests')!;

    const result = await runTests.execute({ target: 'sdk' }, makeSdkCtx());
    expect(adapter.runTests).toHaveBeenCalledWith({ target: 'sdk', args: undefined });
    expect(result).toHaveProperty('success', true);
  });
});

describe('upgrade_complete', () => {
  it('sets frozen=true in the store and returns a message', async () => {
    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const complete = tools.find(t => t.name === 'upgrade_complete')!;

    const result = await complete.execute({}, makeSdkCtx());
    expect(typeof result).toBe('string');
    expect(result as string).toContain('sealed');

    expect(upgradeStore.get(SESSION)?.frozen).toBe(true);
  });
});

describe('upgrade_restart', () => {
  it('returns cancelled when user declines confirmation via requestUserInput', async () => {
    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const restart = tools.find(t => t.name === 'upgrade_restart')!;

    const sdkCtx = makeSdkCtx({
      requestUserInput: vi.fn().mockResolvedValue('no'),
    });

    const result = await restart.execute({}, sdkCtx);
    expect(result).toEqual({ status: 'cancelled' });
    expect(adapter.restart).not.toHaveBeenCalled();
  });

  it('returns cancelled when user declines via adapter.confirm fallback', async () => {
    const adapter = makeAdapter({ confirm: vi.fn().mockResolvedValue(false) });
    const tools = createUpgradeTools(adapter);
    const restart = tools.find(t => t.name === 'upgrade_restart')!;

    // No requestUserInput → falls back to adapter.confirm
    const result = await restart.execute({}, makeSdkCtx());
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('calls adapter.restart when user confirms via requestUserInput', async () => {
    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const restart = tools.find(t => t.name === 'upgrade_restart')!;

    const requestUserInput = vi.fn()
      .mockResolvedValueOnce('yes')   // pre-restart confirm
      .mockResolvedValueOnce(null);   // post-restart prompt (fire-and-forget)

    const sdkCtx = makeSdkCtx({ requestUserInput });

    const result = await restart.execute({}, sdkCtx);
    expect(adapter.restart).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: 'triggered' });
  });

  it('uses adapter.confirm fallback and sets restartPending when no requestUserInput', async () => {
    const adapter = makeAdapter({ confirm: vi.fn().mockResolvedValue(true) });
    const tools = createUpgradeTools(adapter);
    const restart = tools.find(t => t.name === 'upgrade_restart')!;

    // No requestUserInput → adapter.confirm used for pre-restart
    const result = await restart.execute({}, makeSdkCtx());
    expect(adapter.restart).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: 'triggered' });
    // restartPending is set when no requestUserInput and restart is confirmed
    expect(upgradeStore.get(SESSION)?.restartPending).toBe(true);
  });

  it('includes the optional message in the confirmation prompt', async () => {
    const adapter = makeAdapter();
    const tools = createUpgradeTools(adapter);
    const restart = tools.find(t => t.name === 'upgrade_restart')!;

    const requestUserInput = vi.fn()
      .mockResolvedValueOnce('yes')
      .mockResolvedValueOnce(null);

    await restart.execute({ message: 'My upgrade context' }, makeSdkCtx({ requestUserInput }));

    const promptMsg = (requestUserInput.mock.calls[0][0] as { message: string }).message;
    expect(promptMsg).toContain('My upgrade context');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createUpgradeToolSet — lifecycle hooks
// ═══════════════════════════════════════════════════════════════════════════════

describe('createUpgradeToolSet', () => {
  it('has the correct name and description', () => {
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    expect(toolSet.name).toBe('upgrade');
    expect(typeof toolSet.description).toBe('string');
  });

  it('exposes 7 upgrade tools', () => {
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    expect(toolSet.tools).toHaveLength(7);
  });
});

describe('createUpgradeToolSet — onBeforeRun', () => {
  it('resets frozen=false at the start of each run', () => {
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    upgradeStore.setFrozen(SESSION, true);

    toolSet.onBeforeRun?.(ctx, []);

    expect(upgradeStore.get(SESSION)?.frozen).toBe(false);
  });
});

describe('createUpgradeToolSet — onFilterTools', () => {
  function fakeTools(names: Array<{ name: string; group: string }>): Tool[] {
    return names.map(({ name, group }) => ({
      name,
      group,
      description: '',
      parameters: {} as any,
      execute: async () => {},
    }));
  }

  const allFakeTools = fakeTools([
    { name: 'terminal_run',         group: 'Terminal' },
    { name: 'file_read',            group: 'File Management' },
    { name: 'file_write',           group: 'File Management' },
    { name: 'git_status',           group: 'Git' },
    { name: 'git_commit',           group: 'Git' },
    { name: 'upgrade_get_version',  group: 'Upgrade' },
    { name: 'upgrade_build',        group: 'Upgrade' },
    { name: 'upgrade_restart',      group: 'Upgrade' },
    { name: 'upgrade_complete',     group: 'Upgrade' },
  ]);

  it('returns all tools when frozen=false', () => {
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    upgradeStore.setFrozen(SESSION, false);

    const filtered = toolSet.onFilterTools?.(ctx, allFakeTools);
    expect(filtered).toHaveLength(allFakeTools.length);
  });

  it('removes File Management, Git, and non-get-version Upgrade tools when frozen=true', () => {
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    upgradeStore.setFrozen(SESSION, true);

    const filtered = toolSet.onFilterTools?.(ctx, allFakeTools) ?? [];
    const names = filtered.map(t => t.name);

    expect(names).toContain('terminal_run');
    expect(names).toContain('upgrade_get_version');
    expect(names).not.toContain('file_read');
    expect(names).not.toContain('file_write');
    expect(names).not.toContain('git_status');
    expect(names).not.toContain('git_commit');
    expect(names).not.toContain('upgrade_build');
    expect(names).not.toContain('upgrade_restart');
    expect(names).not.toContain('upgrade_complete');
  });
});

describe('createUpgradeToolSet — onGetSystemPrompt', () => {
  const emptyPromptCtx: SystemPromptContext = {
    userMessage: undefined,
    baseSystemPrompt: undefined,
    currentSystemPromptParts: [],
    suppressToolSetPrompt: () => {},
  };

  it('always includes the workflow guidance text', () => {
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    const prompt = toolSet.onGetSystemPrompt?.(ctx, emptyPromptCtx, []) ?? '';
    expect(prompt).toContain('Self-Upgrade Discipline');
    expect(prompt).toContain('upgrade_run_tests');
    expect(prompt).toContain('upgrade_complete');
  });

  it('includes the current version when set in the store', () => {
    upgradeStore.setVersion(SESSION, { version: '2.0.0' });
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    const prompt = toolSet.onGetSystemPrompt?.(ctx, emptyPromptCtx, []) ?? '';
    expect(prompt).toContain('2.0.0');
    expect(prompt).toContain('Current Version');
  });

  it('prepends the FREEZE_BANNER when frozen=true', () => {
    upgradeStore.setFrozen(SESSION, true);
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    const promptCtx: SystemPromptContext = { userMessage: '', baseSystemPrompt: '', currentSystemPromptParts: [], suppressToolSetPrompt: () => {} };
    const prompt = toolSet.onGetSystemPrompt?.(ctx, promptCtx, [toolSet]) ?? '';
    // Banner must come before workflow guidance
    expect(prompt.indexOf('DELIVERY SEALED')).toBeLessThan(prompt.indexOf('Self-Upgrade'));
  });

  it('does not include FREEZE_BANNER when frozen=false', () => {
    upgradeStore.setFrozen(SESSION, false);
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    const promptCtx: SystemPromptContext = { userMessage: '', baseSystemPrompt: '', currentSystemPromptParts: [], suppressToolSetPrompt: () => {} };
    const prompt = toolSet.onGetSystemPrompt?.(ctx, promptCtx, [toolSet]) ?? '';
    expect(prompt).not.toContain('DELIVERY SEALED');
  });
});

describe('createUpgradeToolSet — onGetState', () => {
  it('returns all four upgrade state fields', () => {
    upgradeStore.setVersion(SESSION, { version: '1.0.0' });
    upgradeStore.setDevState(SESSION, 'http://localhost:5173', true);
    upgradeStore.setFrozen(SESSION, true);

    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    const state = toolSet.onGetState?.(ctx) as Record<string, unknown>;

    expect(state?.upgradeInfo).toEqual({ version: '1.0.0' });
    expect(state?.upgradeDevUrl).toBe('http://localhost:5173');
    expect(state?.upgradeDevRunning).toBe(true);
    expect(state?.upgradeFrozen).toBe(true);
  });

  it('returns undefined fields when no bucket exists', () => {
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    const state = toolSet.onGetState?.(ctx) as Record<string, unknown>;
    expect(state?.upgradeInfo).toBeUndefined();
    expect(state?.upgradeDevUrl).toBeUndefined();
    expect(state?.upgradeDevRunning).toBeUndefined();
    expect(state?.upgradeFrozen).toBeUndefined();
  });
});

describe('createUpgradeToolSet — onInitSession', () => {
  it('fetches version from adapter on init', async () => {
    const adapter = makeAdapter();
    const toolSet = createUpgradeToolSet({ adapter });

    toolSet.onInitSession?.(ctx, { id: 'sess', title: 'test' });
    // allow the async getVersion() to settle
    await vi.waitFor(() => {
      return upgradeStore.get(SESSION)?.version !== undefined;
    });

    expect(adapter.getVersion).toHaveBeenCalledOnce();
  });

  it('restores restartPending from snapshot', () => {
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    toolSet.onInitSession?.(ctx, { upgradeRestartPending: true } as any);
    expect(upgradeStore.get(SESSION)?.restartPending).toBe(true);
  });
});

describe('createUpgradeToolSet — onResetSession', () => {
  it('clears restartPending', () => {
    upgradeStore.setRestartPending(SESSION, true);
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    toolSet.onResetSession?.(ctx);
    expect(upgradeStore.get(SESSION)?.restartPending).toBe(false);
  });
});

describe('createUpgradeToolSet — onRemoveSession', () => {
  it('deletes the bucket', () => {
    upgradeStore.setVersion(SESSION, { version: '1.0.0' });
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    toolSet.onRemoveSession?.(ctx);
    expect(upgradeStore.get(SESSION)).toBeUndefined();
  });
});

describe('createUpgradeToolSet — onBuildSnapshot', () => {
  it('includes upgradeRestartPending when the flag is set', () => {
    upgradeStore.setRestartPending(SESSION, true);
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    const snap = toolSet.onBuildSnapshot?.(ctx) as Record<string, unknown>;
    expect(snap?.upgradeRestartPending).toBe(true);
  });

  it('returns empty snapshot when restartPending is false', () => {
    upgradeStore.setRestartPending(SESSION, false);
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    const snap = toolSet.onBuildSnapshot?.(ctx) ?? {};
    expect(Object.keys(snap)).toHaveLength(0);
  });
});

describe('createUpgradeToolSet — onSubscribe', () => {
  it('subscribes to store and returns an unsubscribe function', () => {
    const toolSet = createUpgradeToolSet({ adapter: makeAdapter() });
    const cb = vi.fn();
    const unsub = toolSet.onSubscribe?.(ctx, cb);

    upgradeStore.setVersion(SESSION, { version: '5.0.0' });
    expect(cb).toHaveBeenCalledOnce();

    unsub?.();
    upgradeStore.setVersion(SESSION, { version: '6.0.0' });
    expect(cb).toHaveBeenCalledOnce(); // still once — unsubscribed
  });
});

describe('createUpgradeToolSet — onSessionReady', () => {
  it('does nothing when restartPending is false', () => {
    const adapter = makeAdapter();
    const toolSet = createUpgradeToolSet({ adapter });
    const sendMessage = vi.fn();

    toolSet.onSessionReady?.(ctx, sendMessage);
    expect(adapter.confirm).not.toHaveBeenCalled();
  });

  it('prompts via confirm and sends a message when restartPending=true and user confirms', async () => {
    upgradeStore.setRestartPending(SESSION, true);
    const adapter = makeAdapter({ confirm: vi.fn().mockResolvedValue(true) });
    const toolSet = createUpgradeToolSet({ adapter });
    const sendMessage = vi.fn();

    toolSet.onSessionReady?.(ctx, sendMessage);

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(upgradeStore.get(SESSION)?.restartPending).toBe(false);
  });

  it('does not send a message when user declines continue prompt', async () => {
    upgradeStore.setRestartPending(SESSION, true);
    const adapter = makeAdapter({ confirm: vi.fn().mockResolvedValue(false) });
    const toolSet = createUpgradeToolSet({ adapter });
    const sendMessage = vi.fn();

    toolSet.onSessionReady?.(ctx, sendMessage);

    await vi.waitFor(() => expect(adapter.confirm).toHaveBeenCalledOnce());
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createHttpUpgradeAdapter
// ═══════════════════════════════════════════════════════════════════════════════

describe('createHttpUpgradeAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOk(data: unknown) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
      status: 200,
    } as Response);
  }

  function mockFetchFail(status = 500) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status,
      statusText: 'Server Error',
    } as Response);
  }

  it('getVersion calls GET /api/upgrade/version', async () => {
    mockFetchOk({ version: '1.0.0' });
    const adapter = createHttpUpgradeAdapter();
    const result = await adapter.getVersion();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/upgrade/version');
    expect(result).toEqual({ version: '1.0.0' });
  });

  it('getVersion throws on non-ok response', async () => {
    mockFetchFail(404);
    const adapter = createHttpUpgradeAdapter();
    await expect(adapter.getVersion()).rejects.toThrow('HTTP 404');
  });

  it('build calls POST /api/upgrade/build with a short timeout signal', async () => {
    mockFetchOk({ started: true, terminalId: 'abc-123' });
    const adapter = createHttpUpgradeAdapter();
    const result = await adapter.build();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      '/api/upgrade/build',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
    expect((result as BuildResult).terminalId).toBe('abc-123');
  });

  it('readTerminalOutput calls GET /api/terminals/:id/output?offset=N', async () => {
    mockFetchOk({ output: 'hello', offset: 5, running: true });
    const adapter = createHttpUpgradeAdapter();
    const result = await adapter.readTerminalOutput('term_abc', 5);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/terminals/term_abc/output?offset=5');
    expect(result.output).toBe('hello');
    expect(result.running).toBe(true);
  });

  it('readTerminalOutput throws on non-ok response', async () => {
    mockFetchFail(404);
    const adapter = createHttpUpgradeAdapter();
    await expect(adapter.readTerminalOutput('term_abc', 0)).rejects.toThrow('HTTP 404');
  });

  it('build throws on non-ok response', async () => {
    mockFetchFail(500);
    const adapter = createHttpUpgradeAdapter();
    await expect(adapter.build()).rejects.toThrow('HTTP 500');
  });

  it('restart swallows network errors (server closes connection)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const adapter = createHttpUpgradeAdapter();
    await expect(adapter.restart()).resolves.toBeUndefined();
  });

  it('restart uses custom base url', async () => {
    mockFetchOk({});
    const adapter = createHttpUpgradeAdapter({ baseUrl: 'http://localhost:3000/api' });
    await adapter.restart();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/upgrade/restart',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('devStart calls POST /api/upgrade/dev/start', async () => {
    mockFetchOk({ url: 'http://localhost:5173', alreadyRunning: false });
    const adapter = createHttpUpgradeAdapter();
    const result = await adapter.devStart();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/upgrade/dev/start', expect.objectContaining({ method: 'POST' }));
    expect(result.url).toBe('http://localhost:5173');
  });

  it('devStart throws on non-ok response', async () => {
    mockFetchFail(500);
    const adapter = createHttpUpgradeAdapter();
    await expect(adapter.devStart()).rejects.toThrow('HTTP 500');
  });

  it('devStop calls POST /api/upgrade/dev/stop and ignores errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const adapter = createHttpUpgradeAdapter();
    await expect(adapter.devStop()).resolves.toBeUndefined();
  });

  it('devStatus calls GET /api/upgrade/dev/status', async () => {
    mockFetchOk({ running: true, url: 'http://localhost:5173' });
    const adapter = createHttpUpgradeAdapter();
    const result = await adapter.devStatus();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/upgrade/dev/status');
    expect(result.running).toBe(true);
  });

  it('devStatus throws on non-ok response', async () => {
    mockFetchFail(503);
    const adapter = createHttpUpgradeAdapter();
    await expect(adapter.devStatus()).rejects.toThrow('HTTP 503');
  });

  it('runTests calls POST /api/upgrade/test with body and timeout', async () => {
    mockFetchOk({ started: true, terminalId: 'test-123' });
    const adapter = createHttpUpgradeAdapter();
    const result = await adapter.runTests({ target: 'backend', args: ['--coverage'] });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      '/api/upgrade/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ target: 'backend', args: ['--coverage'] }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual({ started: true, terminalId: 'test-123' });
  });

  it('runTests throws on non-ok response', async () => {
    mockFetchFail(400);
    const adapter = createHttpUpgradeAdapter();
    await expect(adapter.runTests({ target: 'sdk' })).rejects.toThrow('HTTP 400');
  });

  it('strips trailing slash from baseUrl', async () => {
    mockFetchOk({ version: '1.0.0' });
    const adapter = createHttpUpgradeAdapter({ baseUrl: 'http://localhost:3000/api/' });
    await adapter.getVersion();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('http://localhost:3000/api/upgrade/version');
  });
});
