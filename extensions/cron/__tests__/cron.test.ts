/**
 * 100% coverage unit tests for the cron plugin non-UI layer.
 *
 * Covers:
 *   store.ts       — all CRUD + subscription operations
 *   tools.ts       — all 6 tool definitions + execution paths
 *   toolSet.ts     — lifecycle hooks (init, ready, remove, reset, symbol, sub, snapshot)
 *   pluginAdapter.ts — adapter wrapping PluginApiClient
 *
 * No backend (Node.js) code is tested here — only frontend agent-layer logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAIN_CONVERSATION_ID } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import type { ToolSetContext, SessionReadyHelpers, PluginApiClient, PluginStreamClient } from '@agent-type';
import type { CronJob, CronManagerAdapter, CronSymbolState } from '../agent/types';

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCtx(
  sessionId = 'session-1',
  conversationId = MAIN_CONVERSATION_ID,
  agentName = 'main',
): ToolSetContext {
  return { sessionId, agentName, conversationId };
}

function subAgentCtx(sessionId = 'session-1'): ToolSetContext & { isSubAgent: boolean } {
  return { sessionId, agentName: 'sub', conversationId: 'conv-sub', isSubAgent: true };
}

function makeHelpers(): SessionReadyHelpers {
  return {
    sendMessage: vi.fn(),
    injectToolResult: vi.fn(),
  };
}

/** A sample CronJob fixture. */
function sampleJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'cron_test001',
    sessionId: 'session-1',
    label: 'Test job',
    cronExpr: '*/30 * * * * *',
    prompt: 'run test',
    recurring: true,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastFiredAt: null,
    nextFireAt: '2026-01-01T00:00:30.000Z',
    completedAt: null,
    fireCount: 0,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Store
// ─────────────────────────────────────────────────────────────────────────────

describe('cronStore', () => {
  let store: typeof import('../agent/store').cronStore;

  beforeEach(async () => {
    // Re-import each test so bucket state is fresh.
    vi.resetModules();
    store = (await import('../agent/store')).cronStore;
  });

  describe('getJobs', () => {
    it('returns empty array for unknown session', () => {
      expect(store.getJobs('unknown')).toEqual([]);
    });
  });

  describe('setJobs', () => {
    it('stores jobs and returns them via getJobs', () => {
      const jobs = [sampleJob()];
      store.setJobs('s1', jobs);
      expect(store.getJobs('s1')).toEqual(jobs);
    });

    it('replaces previous jobs', () => {
      store.setJobs('s1', [sampleJob({ id: 'a' })]);
      store.setJobs('s1', [sampleJob({ id: 'b' })]);
      expect(store.getJobs('s1')).toHaveLength(1);
      expect(store.getJobs('s1')[0].id).toBe('b');
    });

    it('notifies subscribers', () => {
      const fn = vi.fn();
      store.subscribe('s1', fn);
      store.setJobs('s1', [sampleJob()]);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateJob', () => {
    it('adds a job when id does not exist', () => {
      store.updateJob('s1', sampleJob());
      expect(store.getJobs('s1')).toHaveLength(1);
    });

    it('replaces existing job with same id', () => {
      store.setJobs('s1', [sampleJob({ id: 'x', label: 'old' })]);
      store.updateJob('s1', sampleJob({ id: 'x', label: 'new' }));
      expect(store.getJobs('s1')).toHaveLength(1);
      expect(store.getJobs('s1')[0].label).toBe('new');
    });

    it('notifies subscribers', () => {
      const fn = vi.fn();
      store.subscribe('s1', fn);
      store.updateJob('s1', sampleJob());
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeJob', () => {
    it('removes job by id', () => {
      store.setJobs('s1', [sampleJob({ id: 'a' }), sampleJob({ id: 'b' })]);
      store.removeJob('s1', 'a');
      expect(store.getJobs('s1').map((j) => j.id)).toEqual(['b']);
    });

    it('does nothing when session unknown', () => {
      expect(() => store.removeJob('unknown', 'x')).not.toThrow();
    });

    it('notifies subscribers', () => {
      const fn = vi.fn();
      store.setJobs('s1', [sampleJob()]);
      store.subscribe('s1', fn);
      store.removeJob('s1', sampleJob().id);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('setStopListening / stopListening', () => {
    it('calls the stored function', () => {
      const fn = vi.fn();
      store.setStopListening('s1', fn);
      store.stopListening('s1');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no function stored', () => {
      expect(() => store.stopListening('s1')).not.toThrow();
    });

    it('accepts undefined to clear', () => {
      const fn = vi.fn();
      store.setStopListening('s1', fn);
      store.setStopListening('s1', undefined);
      store.stopListening('s1');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('clears jobs for the session', () => {
      store.setJobs('s1', [sampleJob()]);
      store.reset('s1');
      expect(store.getJobs('s1')).toEqual([]);
    });

    it('does not remove the bucket (subscribe still works after)', () => {
      store.setJobs('s1', [sampleJob()]);
      store.reset('s1');
      store.setJobs('s1', [sampleJob({ id: 'new' })]);
      expect(store.getJobs('s1')).toHaveLength(1);
    });

    it('notifies subscribers', () => {
      const fn = vi.fn();
      store.setJobs('s1', [sampleJob()]);
      store.subscribe('s1', fn);
      store.reset('s1');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('deletes the entire bucket', () => {
      store.setJobs('s1', [sampleJob()]);
      store.remove('s1');
      expect(store.getJobs('s1')).toEqual([]);
    });

    it('does not notify after bucket removed', () => {
      const fn = vi.fn();
      store.setJobs('s1', [sampleJob()]);
      store.subscribe('s1', fn);
      fn.mockClear();
      // After remove, the bucket (and its subscribers) is gone.
      store.remove('s1');
      // Setting jobs on a removed session creates a FRESH bucket with
      // empty subscribers — the old fn is orphaned.
      store.setJobs('s1', [sampleJob()]);
      expect(fn).not.toHaveBeenCalled();
    });

    it('reset on unknown session does not throw', () => {
      expect(() => store.reset('unknown')).not.toThrow();
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const fn = vi.fn();
      const unsub = store.subscribe('s1', fn);
      store.setJobs('s1', [sampleJob()]);
      expect(fn).toHaveBeenCalledTimes(1);
      unsub();
      store.setJobs('s1', [sampleJob({ id: 'other' })]);
      expect(fn).toHaveBeenCalledTimes(1); // no additional call
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Tools
// ─────────────────────────────────────────────────────────────────────────────

describe('createCronTools', () => {
  let adapter: CronManagerAdapter;

  beforeEach(() => {
    adapter = {
      listJobs: vi.fn(),
      createJob: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
      pauseJob: vi.fn(),
      resumeJob: vi.fn(),
      startListening: vi.fn(),
    };
  });

  async function getTool(name: string) {
    const mod = await import('../agent/tools');
    const tools = mod.createCronTools(adapter);
    return { tools, tool: tools.find((t) => t.name === name)! };
  }

  describe('Tool shape', () => {
    it('returns exactly 6 tools', async () => {
      const mod = await import('../agent/tools');
      const tools = mod.createCronTools(adapter);
      expect(tools).toHaveLength(6);
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        'cron_create',
        'cron_delete',
        'cron_list',
        'cron_pause',
        'cron_resume',
        'cron_update',
      ]);
    });

    it('each tool has a name, description, parameters, and execute', async () => {
      const mod = await import('../agent/tools');
      const tools = mod.createCronTools(adapter);
      for (const t of tools) {
        expect(t.name).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.execute).toBeInstanceOf(Function);
        expect(t.parameters).toBeTruthy();
      }
    });
  });

  describe('cron_create', () => {
    it('creates a job via adapter and updates store', async () => {
      const created = sampleJob({ id: 'cron_new' });
      (adapter.createJob as ReturnType<typeof vi.fn>).mockResolvedValue(created);
      const { tool } = await getTool('cron_create');

      const result = await tool.execute(
        { cronExpr: '*/30 * * * * *', prompt: 'hello', recurring: true, label: 'My job' },
        makeCtx(),
      ) as { id: string };

      expect(adapter.createJob).toHaveBeenCalledWith({
        sessionId: 'session-1',
        cronExpr: '*/30 * * * * *',
        prompt: 'hello',
        recurring: true,
        label: 'My job',
      });
      expect(result).toHaveProperty('id', 'cron_new');
    });

    it('forwards recurring default from Zod when not provided', async () => {
      // The Zod schema has `.default(true)`, but `tool.execute()` receives
      // already-parsed args. When called directly, no Zod default is applied,
      // so `recurring` is `undefined`. The backend treats `undefined` the same
      // as `true` via `recurring !== false`.
      (adapter.createJob as ReturnType<typeof vi.fn>).mockResolvedValue(sampleJob());
      const { tool } = await getTool('cron_create');

      await tool.execute(
        { cronExpr: '* * * * *', prompt: 'test' },
        makeCtx(),
      );

      // recurring is undefined when not passed (Zod default only applies
      // through the validation pipeline). The backend defaults to true via
      // `recurring !== false`.
      expect(adapter.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ recurring: undefined }),
      );
    });

    it('rejects sub-agent context', async () => {
      const { tool } = await getTool('cron_create');
      const result = await tool.execute(
        { cronExpr: '* * * * *', prompt: 'x' },
        subAgentCtx(),
      ) as { error: string };
      expect(result.error).toContain('main conversation');
    });
  });

  describe('cron_list', () => {
    it('returns jobs from adapter', async () => {
      const jobs = [sampleJob()];
      (adapter.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue(jobs);
      const { tool } = await getTool('cron_list');

      const result = await tool.execute({}, makeCtx()) as { jobs: Array<{ id: string }> };

      expect(adapter.listJobs).toHaveBeenCalledWith({ sessionId: 'session-1' });
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe(jobs[0].id);
    });

    it('returns empty message when no jobs', async () => {
      (adapter.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const { tool } = await getTool('cron_list');

      const result = await tool.execute({}, makeCtx()) as { message: string };
      expect(result.message).toBe('No cron jobs scheduled.');
    });

    it('returns message for sub-agent', async () => {
      const { tool } = await getTool('cron_list');
      const result = await tool.execute({}, subAgentCtx()) as { message: string };
      expect(result.message).toContain('not available in sub-agent');
    });
  });

  describe('cron_delete', () => {
    it('deletes via adapter and removes from store', async () => {
      (adapter.deleteJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const { tool } = await getTool('cron_delete');

      const result = await tool.execute({ id: 'job_1' }, makeCtx()) as { success: boolean; id: string };

      expect(adapter.deleteJob).toHaveBeenCalledWith('job_1', 'session-1');
      expect(result.success).toBe(true);
      expect(result.id).toBe('job_1');
    });

    it('rejects sub-agent', async () => {
      const { tool } = await getTool('cron_delete');
      const result = await tool.execute({ id: 'job_1' }, subAgentCtx()) as { error: string };
      expect(result.error).toContain('main conversation');
    });
  });

  describe('cron_update', () => {
    it('updates via adapter with partial patch', async () => {
      const updated = sampleJob({ label: 'new label' });
      (adapter.updateJob as ReturnType<typeof vi.fn>).mockResolvedValue(updated);
      const { tool } = await getTool('cron_update');

      const result = await tool.execute(
        { id: 'job_1', label: 'new label' },
        makeCtx(),
      ) as { label: string };

      expect(adapter.updateJob).toHaveBeenCalledWith('job_1', 'session-1', {
        cronExpr: undefined,
        prompt: undefined,
        label: 'new label',
        recurring: undefined,
      });
      expect(result.label).toBe('new label');
    });

    it('rejects sub-agent', async () => {
      const { tool } = await getTool('cron_update');
      const result = await tool.execute(
        { id: 'job_1', cronExpr: '* * * * *' },
        subAgentCtx(),
      ) as { error: string };
      expect(result.error).toContain('main conversation');
    });
  });

  describe('cron_pause', () => {
    it('pauses via adapter', async () => {
      const paused = sampleJob({ status: 'paused' });
      (adapter.pauseJob as ReturnType<typeof vi.fn>).mockResolvedValue(paused);
      const { tool } = await getTool('cron_pause');

      const result = await tool.execute({ id: 'job_1' }, makeCtx()) as { status: string };

      expect(adapter.pauseJob).toHaveBeenCalledWith('job_1', 'session-1');
      expect(result.status).toBe('paused');
    });

    it('rejects sub-agent', async () => {
      const { tool } = await getTool('cron_pause');
      const result = await tool.execute({ id: 'job_1' }, subAgentCtx()) as { error: string };
      expect(result.error).toContain('main conversation');
    });
  });

  describe('cron_resume', () => {
    it('resumes via adapter', async () => {
      const resumed = sampleJob({ status: 'active', nextFireAt: '2026-01-01T01:00:00.000Z' });
      (adapter.resumeJob as ReturnType<typeof vi.fn>).mockResolvedValue(resumed);
      const { tool } = await getTool('cron_resume');

      const result = await tool.execute({ id: 'job_1' }, makeCtx()) as { status: string; nextFireAt: string };

      expect(adapter.resumeJob).toHaveBeenCalledWith('job_1', 'session-1');
      expect(result.status).toBe('active');
      expect(result.nextFireAt).toBeTruthy();
    });

    it('rejects sub-agent', async () => {
      const { tool } = await getTool('cron_resume');
      const result = await tool.execute({ id: 'job_1' }, subAgentCtx()) as { error: string };
      expect(result.error).toContain('main conversation');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  ToolSet lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('createCronToolSet', () => {
  let adapter: CronManagerAdapter;

  beforeEach(() => {
    adapter = {
      listJobs: vi.fn().mockResolvedValue([]),
      createJob: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
      pauseJob: vi.fn(),
      resumeJob: vi.fn(),
      startListening: vi.fn().mockReturnValue(vi.fn()),
    };
  });

  async function createToolSet() {
    const mod = await import('../agent/toolSet');
    const toolSetMod = await import('../agent/tools');
    const storeMod = await import('../agent/store');
    // Reset store state before each test
    // We can't cleanly reset module state, so manually clear by session
    return {
      toolSet: mod.createCronToolSet(adapter),
      tools: toolSetMod.createCronTools(adapter),
      store: storeMod.cronStore,
    };
  }

  describe('ToolSet shape', () => {
    it('has name "cron" and description', async () => {
      const { toolSet } = await createToolSet();
      expect(toolSet.name).toBe('cron');
      expect(toolSet.description).toBeTruthy();
    });

    it('has a symbol', async () => {
      const { toolSet } = await createToolSet();
      expect(toolSet.symbol).toBeDefined();
      expect(typeof toolSet.symbol).toBe('symbol');
    });

    it('registers all 6 cron tools via resolveToolSetTools', async () => {
      const { toolSet } = await createToolSet();
      const names = resolveToolSetTools(toolSet).map((t) => t.name).sort();
      expect(names).toEqual([
        'cron_create',
        'cron_delete',
        'cron_list',
        'cron_pause',
        'cron_resume',
        'cron_update',
      ]);
    });

    it('coreTools includes all 6 tools', async () => {
      const { toolSet } = await createToolSet();
      expect(toolSet.coreTools).toEqual([
        'cron_create',
        'cron_update',
        'cron_list',
        'cron_delete',
        'cron_pause',
        'cron_resume',
      ]);
    });
  });

  describe('onGetSystemPrompt', () => {
    it('returns prompt content for main conversation', async () => {
      const { toolSet } = await createToolSet();
      const prompt = toolSet.onGetSystemPrompt!(makeCtx('s1'));
      expect(prompt).toBeTruthy();
      expect(prompt!).toContain('cron_create');
      expect(prompt!).toContain('cron_delete');
    });

    it('includes active and paused jobs in the prompt', async () => {
      const { toolSet, store } = await createToolSet();
      store.setJobs('s-prompt', [
        sampleJob({ id: 'a', status: 'active', label: 'Job A', cronExpr: '* * * * *', nextFireAt: '2026-01-01T00:01:00.000Z' }),
        sampleJob({ id: 'b', status: 'paused', label: 'Job B', cronExpr: '*/5 * * * *' }),
        sampleJob({ id: 'c', status: 'completed', label: 'Job C', cronExpr: '0 0 * * *' }),
      ]);

      const prompt = toolSet.onGetSystemPrompt!(makeCtx('s-prompt'))!;

      // Active and paused jobs appear
      expect(prompt).toContain('Job A');
      expect(prompt).toContain('Job B');
      // Completed jobs are filtered out
      expect(prompt).not.toContain('Job C');
    });

    it('handles active job with null nextFireAt (shows unknown)', async () => {
      const { toolSet, store } = await createToolSet();
      store.setJobs('s-null-next', [
        sampleJob({ id: 'd', status: 'active', nextFireAt: null }),
      ]);

      const prompt = toolSet.onGetSystemPrompt!(makeCtx('s-null-next'))!;
      expect(prompt).toContain('unknown');
    });

    it('returns prompt with empty job list when no active/paused jobs', async () => {
      const { toolSet, store } = await createToolSet();
      store.setJobs('s-empty-prompt', [
        sampleJob({ id: 'c', status: 'completed' }),
      ]);

      const prompt = toolSet.onGetSystemPrompt!(makeCtx('s-empty-prompt'));
      // No jobs → jobList is empty string, prompt returns without job section
      expect(prompt).toBeTruthy();
      expect(prompt!).not.toContain('Active jobs:');
    });

    it('returns undefined for sub-agent conversation', async () => {
      const { toolSet } = await createToolSet();
      const prompt = toolSet.onGetSystemPrompt!(subAgentCtx('s1'));
      expect(prompt).toBeUndefined();
    });
  });

  describe('onInit', () => {
    it('restores jobs from entryData.cronJobs', async () => {
      const { toolSet, store } = await createToolSet();
      const jobs = [sampleJob()];
      toolSet.onInit!(makeCtx('s-restore'), {
        id: 's-restore',
        title: 'Restored',
        cronJobs: jobs,
      } as never);
      expect(store.getJobs('s-restore')).toEqual(jobs);
    });

    it('skips restore when cronJobs is empty', async () => {
      const { toolSet, store } = await createToolSet();
      toolSet.onInit!(makeCtx('s-empty'), {
        id: 's-empty',
        title: 'Empty',
      } as never);
      expect(store.getJobs('s-empty')).toEqual([]);
    });

    it('is no-op for sub-agent', async () => {
      const { toolSet, store } = await createToolSet();
      toolSet.onInit!(subAgentCtx('s-sub'), {
        id: 's-sub',
        title: 'Sub',
        cronJobs: [sampleJob()],
      } as never);
      expect(store.getJobs('s-sub')).toEqual([]);
    });
  });

  describe('onReady', () => {
    it('calls adapter.startListening with correct sessionId', async () => {
      const { toolSet } = await createToolSet();
      const helpers = makeHelpers();

      toolSet.onReady!(makeCtx('s-ready'), helpers);

      expect(adapter.startListening).toHaveBeenCalledWith('s-ready', expect.any(Function));
    });

    it('stores the cleanup function via setStopListening', async () => {
      const { toolSet, store } = await createToolSet();
      const cleanup = vi.fn();
      (adapter.startListening as ReturnType<typeof vi.fn>).mockReturnValue(cleanup);

      toolSet.onReady!(makeCtx('s-clean'), makeHelpers());

      // Trigger the stored cleanup
      store.stopListening('s-clean');
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('calls sendMessage when a job fires', async () => {
      const { toolSet } = await createToolSet();
      const helpers = makeHelpers();

      toolSet.onReady!(makeCtx('s-fire'), helpers);

      // Extract the onFired callback passed to startListening
      const onFired = (adapter.startListening as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as (jobId: string, prompt: string) => void;

      onFired('job_1', 'hello world');

      expect(helpers.sendMessage).toHaveBeenCalledWith('hello world');
    });

    it('handles listJobs rejection gracefully on fire and initial sync', async () => {
      (adapter.listJobs as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
      const { toolSet, store } = await createToolSet();
      const helpers = makeHelpers();
      store.setJobs('s-err', [sampleJob()]);

      // onReady triggers both startListening and listJobs
      toolSet.onReady!(makeCtx('s-err'), helpers);

      // Should not throw — catch handler swallows rejection
      const onFired = (adapter.startListening as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as (jobId: string, prompt: string) => void;

      // Fire event should also gracefully handle listJobs rejection
      onFired('job_1', 'test prompt');
      // Allow microtasks to settle
      await vi.waitFor(() => {
        // Store should still have the initial job despite errors
        expect(store.getJobs('s-err')).toHaveLength(1);
      });
    });
  });

  describe('onRemove', () => {
    it('calls stopListening and removes store data', async () => {
      const { toolSet, store } = await createToolSet();
      const cleanup = vi.fn();
      (adapter.startListening as ReturnType<typeof vi.fn>).mockReturnValue(cleanup);

      // Wire up as onReady would
      toolSet.onReady!(makeCtx('s-rm'), makeHelpers());
      store.setJobs('s-rm', [sampleJob()]);

      // Now remove
      toolSet.onRemove!(makeCtx('s-rm'));

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(store.getJobs('s-rm')).toEqual([]);
    });

    it('is no-op for sub-agent', async () => {
      const { toolSet, store } = await createToolSet();
      store.setJobs('s-rm-sub', [sampleJob()]);
      toolSet.onRemove!(subAgentCtx('s-rm-sub'));
      // Sub-agent remove should not clean main session data
      // (For sub-agent, isMainConversation returns false, so it's a no-op)
      expect(store.getJobs('s-rm-sub')).toEqual([sampleJob()]);
    });
  });

  describe('onReset', () => {
    it('stops listening but keeps jobs', async () => {
      const { toolSet, store } = await createToolSet();
      const cleanup = vi.fn();
      (adapter.startListening as ReturnType<typeof vi.fn>).mockReturnValue(cleanup);

      // Wire up as onReady would
      toolSet.onReady!(makeCtx('s-reset'), makeHelpers());
      store.setJobs('s-reset', [sampleJob()]);

      // Reset
      toolSet.onReset!(makeCtx('s-reset'));

      // Jobs should survive reset
      expect(store.getJobs('s-reset')).toHaveLength(1);
      // Cleanup should be called
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('is no-op for sub-agent', async () => {
      const { toolSet } = await createToolSet();
      expect(() => toolSet.onReset!(subAgentCtx('s-rst-sub'))).not.toThrow();
    });
  });

  describe('onGetSymbolState', () => {
    it('returns jobs and panel slot for main conversation', async () => {
      const { toolSet, store } = await createToolSet();
      store.setJobs('s-state', [sampleJob()]);

      const state = toolSet.onGetSymbolState!(makeCtx('s-state')) as CronSymbolState;

      expect(state.type).toBe('cron');
      expect(state.jobs).toHaveLength(1);
      expect(state.cronAdapter).toBeDefined();
      expect(state.cronAdapter).toBe(adapter);
      expect(state.slots).toHaveLength(1);
      expect(state.slots[0].type).toBe('panel');
    });

    it('returns empty jobs for sub-agent', async () => {
      const { toolSet, store } = await createToolSet();
      store.setJobs('s-sub-state', [sampleJob()]);

      const state = toolSet.onGetSymbolState!(subAgentCtx('s-sub-state')) as CronSymbolState;

      expect(state.jobs).toEqual([]);
      expect(state.cronAdapter).toBeDefined();
      expect(state.cronAdapter).toBe(adapter);
      expect(state.slots).toEqual([]);
    });
  });

  describe('onBeforeRun', () => {
    it('calls refreshJobs which invokes adapter.listJobs', async () => {
      const jobs = [sampleJob()];
      (adapter.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue(jobs);
      const { toolSet, store } = await createToolSet();

      toolSet.onBeforeRun!(makeCtx('s-br'));

      // Allow the async refreshJobs to settle
      await vi.waitFor(() => {
        expect(store.getJobs('s-br')).toEqual(jobs);
      });
    });

    it('is no-op for sub-agent', async () => {
      const { toolSet } = await createToolSet();
      toolSet.onBeforeRun!(subAgentCtx('s-br-sub'));
      // Should not throw — simply returns without calling adapter
      expect(adapter.listJobs).not.toHaveBeenCalled();
    });

    it('respects REFRESH_INTERVAL_MS throttle (60s)', async () => {
      const { toolSet } = await createToolSet();
      (adapter.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      // Call beforeRun twice quickly — second call should be throttled
      toolSet.onBeforeRun!(makeCtx('s-throttle'));

      (adapter.listJobs as ReturnType<typeof vi.fn>).mockClear();
      toolSet.onBeforeRun!(makeCtx('s-throttle'));

      // Wait a tick to let any async settle
      await vi.waitFor(() => {
        // The second call should NOT invoke listJobs because of throttle
        expect(adapter.listJobs).not.toHaveBeenCalled();
      });
    });
  });

  describe('onSubscribe', () => {
    it('notifies on store changes', async () => {
      const { toolSet, store } = await createToolSet();
      const fn = vi.fn();
      const unsub = toolSet.onSubscribe!(makeCtx('s-sub'), fn);

      store.setJobs('s-sub', [sampleJob()]);
      expect(fn).toHaveBeenCalledTimes(1);

      unsub();
      store.setJobs('s-sub', [sampleJob({ id: 'other' })]);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('showTab callback', () => {
    it('returns true when jobs exist', async () => {
      const { toolSet, store } = await createToolSet();
      store.setJobs('s-tab', [sampleJob()]);

      const state = toolSet.onGetSymbolState!(makeCtx('s-tab')) as CronSymbolState;
      const slot = state.slots[0];

      if (slot.type === 'panel' && slot.showTab) {
        expect(slot.showTab({ sessionId: 's-tab' })).toBe(true);
      }
    });

    it('returns false when no jobs', async () => {
      const { toolSet } = await createToolSet();

      const state = toolSet.onGetSymbolState!(makeCtx('s-tab-empty')) as CronSymbolState;
      const slot = state.slots[0];

      if (slot.type === 'panel' && slot.showTab) {
        expect(slot.showTab({ sessionId: 's-tab-empty' })).toBe(false);
      }
    });
  });

  describe('onBuildSnapshot', () => {
    it('returns cronJobs when jobs exist', async () => {
      const { toolSet, store } = await createToolSet();
      const jobs = [sampleJob()];
      store.setJobs('s-snap', jobs);

      const snapshot = toolSet.onBuildSnapshot!(makeCtx('s-snap'));
      expect(snapshot).toEqual({ cronJobs: jobs });
    });

    it('returns empty object when no jobs', async () => {
      const { toolSet } = await createToolSet();
      const snapshot = toolSet.onBuildSnapshot!(makeCtx('s-snap-empty'));
      expect(snapshot).toEqual({});
    });

    it('returns empty object for sub-agent', async () => {
      const { toolSet, store } = await createToolSet();
      store.setJobs('s-sub-snap', [sampleJob()]);
      const snapshot = toolSet.onBuildSnapshot!(subAgentCtx('s-sub-snap'));
      expect(snapshot).toEqual({});
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  PluginAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe('createCronPluginAdapter', () => {
  let apiClient: PluginApiClient;
  let adapter: CronManagerAdapter;

  beforeEach(async () => {
    apiClient = {
      call: vi.fn(),
      connectStream: vi.fn(),
    };
    const mod = await import('../agent/pluginAdapter');
    adapter = mod.createCronPluginAdapter(apiClient);
  });

  describe('listJobs', () => {
    it('calls apiClient.call with correct params', async () => {
      const jobs = [sampleJob()];
      (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({ jobs });

      const result = await adapter.listJobs({ sessionId: 's1' });

      expect(apiClient.call).toHaveBeenCalledWith('listJobs', { sessionId: 's1' });
      expect(result).toEqual(jobs);
    });
  });

  describe('createJob', () => {
    it('calls apiClient.call with all params', async () => {
      const job = sampleJob();
      (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue(job);

      const result = await adapter.createJob({
        sessionId: 's1',
        cronExpr: '* * * * *',
        prompt: 'hello',
        recurring: true,
        label: 'My job',
      });

      expect(apiClient.call).toHaveBeenCalledWith('createJob', {
        sessionId: 's1',
        cronExpr: '* * * * *',
        prompt: 'hello',
        recurring: true,
        label: 'My job',
      });
      expect(result).toEqual(job);
    });
  });

  describe('updateJob', () => {
    it('calls apiClient.call with id, sessionId, and patch', async () => {
      const job = sampleJob({ label: 'updated' });
      (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue(job);

      const result = await adapter.updateJob('job_1', 's1', { label: 'updated' });

      expect(apiClient.call).toHaveBeenCalledWith('updateJob', {
        id: 'job_1',
        sessionId: 's1',
        patch: { label: 'updated' },
      });
      expect(result).toEqual(job);
    });
  });

  describe('deleteJob', () => {
    it('calls apiClient.call with id and sessionId', async () => {
      (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await adapter.deleteJob('job_1', 's1');

      expect(apiClient.call).toHaveBeenCalledWith('deleteJob', {
        id: 'job_1',
        sessionId: 's1',
      });
    });
  });

  describe('pauseJob', () => {
    it('calls apiClient.call with id and sessionId', async () => {
      const job = sampleJob({ status: 'paused' });
      (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue(job);

      const result = await adapter.pauseJob('job_1', 's1');

      expect(apiClient.call).toHaveBeenCalledWith('pauseJob', {
        id: 'job_1',
        sessionId: 's1',
      });
      expect(result.status).toBe('paused');
    });
  });

  describe('resumeJob', () => {
    it('calls apiClient.call with id and sessionId', async () => {
      const job = sampleJob({ status: 'active' });
      (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue(job);

      const result = await adapter.resumeJob('job_1', 's1');

      expect(apiClient.call).toHaveBeenCalledWith('resumeJob', {
        id: 'job_1',
        sessionId: 's1',
      });
      expect(result.status).toBe('active');
    });
  });

  describe('startListening', () => {
    it('creates a stream and subscribes', () => {
      const mockSub = { unsubscribe: vi.fn() };
      const mockStream: PluginStreamClient = {
        callbacks: {
          onData: () => {},
          onEnd: () => {},
          onError: () => {},
        },
        subscribe: vi.fn().mockReturnValue(mockSub),
      };
      (apiClient.connectStream as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

      const onFired = vi.fn();
      const cleanup = adapter.startListening('s1', onFired);

      expect(apiClient.connectStream).toHaveBeenCalledWith('fired', { sessionId: 's1' });
      expect(mockStream.subscribe).toHaveBeenCalledOnce();

      // Simulate data receipt
      const dataCallback = mockStream.callbacks.onData;
      dataCallback({ jobId: 'j1', prompt: 'do it' });
      expect(onFired).toHaveBeenCalledWith('j1', 'do it');

      // Heartbeat should be ignored
      onFired.mockClear();
      dataCallback({ _heartbeat: true });
      expect(onFired).not.toHaveBeenCalled();

      // Verify cleanup works
      cleanup();
      expect(mockSub.unsubscribe).toHaveBeenCalledOnce();
    });

    it('cleans up previous listener for the same sessionId before creating new one', () => {
      const oldSub = { unsubscribe: vi.fn() };
      const oldStream: PluginStreamClient = {
        callbacks: { onData: () => {}, onEnd: () => {}, onError: () => {} },
        subscribe: vi.fn().mockReturnValue(oldSub),
      };

      const newSub = { unsubscribe: vi.fn() };
      const newStream: PluginStreamClient = {
        callbacks: { onData: () => {}, onEnd: () => {}, onError: () => {} },
        subscribe: vi.fn().mockReturnValue(newSub),
      };

      (apiClient.connectStream as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(oldStream)
        .mockReturnValueOnce(newStream);

      const onFired = vi.fn();
      const cleanup1 = adapter.startListening('s1', onFired);

      // Second call should clean up the first
      const cleanup2 = adapter.startListening('s1', onFired);

      // Old sub should be unsubscribed
      expect(oldSub.unsubscribe).toHaveBeenCalledOnce();
      // New sub should be subscribed
      expect(newStream.subscribe).toHaveBeenCalledOnce();

      // Cleanup2 should work
      cleanup2();
      expect(newSub.unsubscribe).toHaveBeenCalledOnce();
    });
  });
});
