import { describe, it, expect } from 'vitest';
import { createExperienceTools } from '../../tools/experience/experience';
import { MAIN_CONVERSATION_ID } from '../../tools/toolSet';
import type { SystemPromptContext } from '@agent-type';
import type { ExperienceItem } from '../../tools/experience/experience';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'session-1') {
  return {
    sessionId,
    agentName: 'main',
    conversationId: MAIN_CONVERSATION_ID,
    signal: new AbortController().signal,
    };
}

/**
 * ToolSetContext for lifecycle hook calls (main-agent scope).
 */
function makeTsCtx(sessionId = 'session-1') {
  return { sessionId, agentName: 'main', conversationId: MAIN_CONVERSATION_ID };
}

const emptyPromptCtx: SystemPromptContext = {
  userMessage: undefined,
  baseSystemPrompt: undefined,
  currentSystemPromptParts: [],
  suppressToolSetPrompt: () => {},
};

function makeSubAgentCtx(agentName: string, convId: string, sessionId = 'session-1') {
  return {
    sessionId,
    agentName,
    conversationId: convId, // sub-agent: conversationId !== sessionId
    signal: new AbortController().signal,
    };
}

function getTool(ts: ReturnType<typeof createExperienceTools>, name: string) {
  const t = (ts.tools as any[]).find((x) => x.name === name);
  if (!t) throw new Error(`Tool "${name}" not found`);
  return t;
}

async function addExperience(
  ts: ReturnType<typeof createExperienceTools>,
  input: { trigger: string; insight: string; evidence?: string; confidence?: number; tags?: string[] },
  sessionId = 'session-1',
): Promise<{ success: boolean; id: string; total: number }> {
  return getTool(ts, 'experience_add').execute(input, makeCtx(sessionId));
}

async function listExperiences(
  ts: ReturnType<typeof createExperienceTools>,
  sessionId = 'session-1',
  tag?: string,
): Promise<{ experiences: ExperienceItem[]; total: number }> {
  return getTool(ts, 'experience_list').execute({ tag }, makeCtx(sessionId));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createExperienceTools', () => {
  // ── ToolSet shape ──────────────────────────────────────────────────────────

  it('returns a ToolSet with name "experience"', () => {
    const ts = createExperienceTools();
    expect(ts.name).toBe('experience');
  });

  it('exports four tools', () => {
    const ts = createExperienceTools();
    const names = (ts.tools as any[]).map((t) => t.name);
    expect(names).toContain('experience_add');
    expect(names).toContain('experience_update');
    expect(names).toContain('experience_delete');
    expect(names).toContain('experience_list');
    expect(ts.tools).toHaveLength(4);
  });

  // ── experience_list (empty) ────────────────────────────────────────────────

  it('experience_list returns empty list before any additions', async () => {
    const ts = createExperienceTools();
    const result = await listExperiences(ts);
    expect(result.experiences).toEqual([]);
    expect(result.total).toBe(0);
  });

  // ── experience_add ─────────────────────────────────────────────────────────

  it('experience_add stores an item and returns its id', async () => {
    const ts = createExperienceTools();
    const result = await addExperience(ts, {
      trigger: 'REST.status=429; Retry-After∈response.headers',
      insight: 'sleep(ms=int(Retry-After)*1000); retry(max=3)',
    });
    expect(result.success).toBe(true);
    expect(typeof result.id).toBe('string');
    expect(result.total).toBe(1);
  });

  it('experience_add stores tags', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, {
      trigger: 'TypeScript.strict=true; implicit_any in param',
      insight: 'add explicit type; prefer unknown+narrowing',
      tags: ['typescript', 'quality'],
    });
    const { experiences } = await listExperiences(ts);
    expect(experiences[0].tags).toEqual(['typescript', 'quality']);
  });

  it('experience_add stores trigger and insight correctly', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, {
      trigger: 'env.node=missing; require("some-pkg") throws',
      insight: 'npm install some-pkg --save-dev; check engines field',
    });
    const { experiences } = await listExperiences(ts);
    expect(experiences[0].trigger).toBe('env.node=missing; require("some-pkg") throws');
    expect(experiences[0].insight).toBe('npm install some-pkg --save-dev; check engines field');
  });

  it('experience_add stores optional evidence and confidence', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, {
      trigger: 'git.push; branch=protected',
      insight: 'open PR -> request force-push OR rebase',
      evidence: 'direct push rejected by branch protection rules',
      confidence: 0.9,
    });
    const { experiences } = await listExperiences(ts);
    expect(experiences[0].evidence).toBe('direct push rejected by branch protection rules');
    expect(experiences[0].confidence).toBe(0.9);
  });

  it('experience_add increments total across multiple calls', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, { trigger: 'T1', insight: 'I1' });
    const r2 = await addExperience(ts, { trigger: 'T2', insight: 'I2' });
    expect(r2.total).toBe(2);
  });

  // ── experience_list ────────────────────────────────────────────────────────

  it('experience_list returns all entries', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, { trigger: 'TA', insight: 'IA' });
    await addExperience(ts, { trigger: 'TB', insight: 'IB' });
    const { experiences, total } = await listExperiences(ts);
    expect(total).toBe(2);
    expect(experiences.map((e) => e.trigger)).toContain('TA');
    expect(experiences.map((e) => e.trigger)).toContain('TB');
  });

  it('experience_list filters by tag', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, { trigger: 'TA', insight: 'IA', tags: ['ts'] });
    await addExperience(ts, { trigger: 'TB', insight: 'IB', tags: ['js'] });
    const { experiences } = await listExperiences(ts, 'session-1', 'ts');
    expect(experiences).toHaveLength(1);
    expect(experiences[0].trigger).toBe('TA');
  });

  // ── experience_update ──────────────────────────────────────────────────────

  it('experience_update changes trigger', async () => {
    const ts = createExperienceTools();
    const { id } = await addExperience(ts, { trigger: 'old_trigger', insight: 'some insight' });
    const result = await getTool(ts, 'experience_update').execute(
      { id, trigger: 'new_trigger' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const { experiences } = await listExperiences(ts);
    expect(experiences[0].trigger).toBe('new_trigger');
  });

  it('experience_update changes insight', async () => {
    const ts = createExperienceTools();
    const { id } = await addExperience(ts, { trigger: 'some_trigger', insight: 'old_insight' });
    await getTool(ts, 'experience_update').execute({ id, insight: 'new_insight' }, makeCtx());
    const { experiences } = await listExperiences(ts);
    expect(experiences[0].insight).toBe('new_insight');
  });

  it('experience_update changes confidence', async () => {
    const ts = createExperienceTools();
    const { id } = await addExperience(ts, { trigger: 'T', insight: 'I', confidence: 0.6 });
    await getTool(ts, 'experience_update').execute({ id, confidence: 0.9 }, makeCtx());
    const { experiences } = await listExperiences(ts);
    expect(experiences[0].confidence).toBe(0.9);
  });

  it('experience_update returns failure for unknown id', async () => {
    const ts = createExperienceTools();
    const result = await getTool(ts, 'experience_update').execute(
      { id: 'does-not-exist', trigger: 'x' },
      makeCtx(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  // ── experience_delete ──────────────────────────────────────────────────────

  it('experience_delete removes an entry', async () => {
    const ts = createExperienceTools();
    const { id } = await addExperience(ts, { trigger: 'T', insight: 'to delete' });
    const result = await getTool(ts, 'experience_delete').execute({ id }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(0);
    const { total } = await listExperiences(ts);
    expect(total).toBe(0);
  });

  it('experience_delete returns failure for unknown id', async () => {
    const ts = createExperienceTools();
    const result = await getTool(ts, 'experience_delete').execute(
      { id: 'does-not-exist' },
      makeCtx(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  // ── session isolation ──────────────────────────────────────────────────────

  it('sessions share the global experience pool', async () => {
    // Experiences are cross-session and permanent by design �?every session
    // reads from the same global pool within a factory instance.
    const ts = createExperienceTools();
    await addExperience(ts, { trigger: 'T', insight: 'I' }, 'session-1');
    const { total } = await listExperiences(ts, 'session-2');
    expect(total).toBe(1);
  });

  // ── sub-agent isolation ────────────────────────────────────────────────────

  it('sub-agents are excluded via onFilterTools, not via separate stores', () => {
    // The global store is shared �?sub-agents are restricted by filtering experience
    // tools out of their tool list via onFilterTools, not by store isolation.
    const ts = createExperienceTools();
    const mainCtx = makeTsCtx('session-1');
    const subCtx = { sessionId: 'session-1', agentName: 'bot', conversationId: 'conv-99' };

    const allTools = ts.tools as any[];

    // Main agent: experience tools are kept.
    const filteredMain = ts.onFilterTools!(mainCtx, allTools);
    expect(filteredMain.map((t: any) => t.name)).toContain('experience_add');
    expect(filteredMain.map((t: any) => t.name)).toContain('experience_list');

    // Sub-agent: experience tools are removed.
    const filteredSub = ts.onFilterTools!(subCtx, allTools);
    expect(filteredSub.map((t: any) => t.name)).not.toContain('experience_add');
    expect(filteredSub.map((t: any) => t.name)).not.toContain('experience_list');
  });

  // ── onGetSystemPrompt ──────────────────────────────────────────────────────

  it('onGetSystemPrompt returns guidance string when no experiences stored', () => {
    const ts = createExperienceTools();
    const prompt = ts.onGetSystemPrompt?.(makeTsCtx(), emptyPromptCtx, []);
    expect(prompt).toMatch(/## Experience/);
    expect(prompt).toMatch(/experience_add/);
  });

  it('onGetSystemPrompt returns dense block format when experiences exist', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, {
      trigger: 'REST.status=429',
      insight: 'sleep(ms=1000); retry(max=3)',
    });
    const prompt = ts.onGetSystemPrompt?.(makeTsCtx(), emptyPromptCtx, []);
    expect(prompt).toMatch(/## Experience/);
    expect(prompt).toMatch(/TRIGGER/);
    expect(prompt).toMatch(/INSIGHT/);
    expect(prompt).toMatch(/REST\.status=429/);
    expect(prompt).toMatch(/sleep\(ms=1000\)/);
  });

  it('onGetSystemPrompt includes EVIDENCE when present', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, {
      trigger: 'git.push; branch=protected',
      insight: 'open PR',
      evidence: 'direct push rejected',
    });
    const prompt = ts.onGetSystemPrompt?.(makeTsCtx(), emptyPromptCtx, []);
    expect(prompt).toMatch(/EVIDENCE/);
    expect(prompt).toMatch(/direct push rejected/);
  });

  it('onGetSystemPrompt includes tags and confidence when present', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, {
      trigger: 'T',
      insight: 'I',
      confidence: 0.8,
      tags: ['perf'],
    });
    const prompt = ts.onGetSystemPrompt?.(makeTsCtx(), emptyPromptCtx, []);
    expect(prompt).toMatch(/conf=0\.80/);
    expect(prompt).toMatch(/#perf/);
  });

  // ── lifecycle: onInitSession ───────────────────────────────────────────────

  it('onInitSession restores experiences from entryData', async () => {
    const ts = createExperienceTools();
    const saved: ExperienceItem[] = [
      {
        id: 'a1b2c3d4-0000-0000-0000-000000000000',
        trigger: 'REST.status=429',
        insight: 'retry with backoff',
        createdAt: '2024-01-01',
      },
    ];
    ts.onInitSession?.(makeTsCtx('session-restored'), { id: 'session-restored', title: 'Test', experiences: saved });
    const result = await listExperiences(ts, 'session-restored');
    expect(result.total).toBe(1);
    expect(result.experiences[0].trigger).toBe('REST.status=429');
    expect(result.experiences[0].insight).toBe('retry with backoff');
  });

  it('onInitSession ignores missing entryData', () => {
    const ts = createExperienceTools();
    expect(() => ts.onInitSession?.(makeTsCtx('session-new'), { id: 'session-new', title: 'New' })).not.toThrow();
  });

  // ── lifecycle: onRemoveSession ─────────────────────────────────────────────

  it('onRemoveSession does not clear experiences (they are permanent)', async () => {
    // Experiences are cross-session and permanent �?removing a session does
    // not delete the global experience pool.
    const ts = createExperienceTools();
    await addExperience(ts, { trigger: 'T', insight: 'Will survive removal' });
    ts.onRemoveSession?.(makeTsCtx());
    const result = await listExperiences(ts);
    expect(result.total).toBe(1);
  });

  // ── lifecycle: onResetSession ──────────────────────────────────────────────

  it('onResetSession does not clear experiences (they persist across history clears)', async () => {
    // Experiences are permanent �?clearing conversation history does not
    // delete the global experience pool.
    const ts = createExperienceTools();
    await addExperience(ts, { trigger: 'T', insight: 'Before reset' });
    ts.onResetSession?.(makeTsCtx());
    const result = await listExperiences(ts);
    expect(result.total).toBe(1);
  });

  // ── lifecycle: onGetState ──────────────────────────────────────────────────

  it('onGetState returns the current experiences array', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, { trigger: 'state_trigger', insight: 'State entry' });
    const state = ts.onGetState?.(makeTsCtx()) as { experiences: ExperienceItem[] };
    expect(state.experiences).toHaveLength(1);
    expect(state.experiences[0].trigger).toBe('state_trigger');
    expect(state.experiences[0].insight).toBe('State entry');
  });

  // ── lifecycle: onSubscribe ─────────────────────────────────────────────────

  it('onSubscribe fires listener on add', async () => {
    const ts = createExperienceTools();
    const calls: number[] = [];
    ts.onSubscribe?.(makeTsCtx(), () => calls.push(1));
    await addExperience(ts, { trigger: 'T', insight: 'Trigger' });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('onSubscribe unsubscribes correctly', async () => {
    const ts = createExperienceTools();
    const calls: number[] = [];
    const unsub = ts.onSubscribe?.(makeTsCtx(), () => calls.push(1));
    unsub?.();
    await addExperience(ts, { trigger: 'T', insight: 'After unsub' });
    expect(calls.length).toBe(0);
  });

  // ── lifecycle: onBuildSnapshot ─────────────────────────────────────────────

  it('onBuildSnapshot returns empty object when no experiences', () => {
    const ts = createExperienceTools();
    const snap = ts.onBuildSnapshot?.(makeTsCtx());
    expect(snap).toEqual({});
  });

  it('onBuildSnapshot returns experiences when present', async () => {
    const ts = createExperienceTools();
    await addExperience(ts, { trigger: 'snap_trigger', insight: 'Snapshot lesson' });
    const snap = ts.onBuildSnapshot?.(makeTsCtx()) as { experiences: ExperienceItem[] };
    expect(snap.experiences).toHaveLength(1);
    expect(snap.experiences[0].trigger).toBe('snap_trigger');
  });

  // ── experience_update additional fields ────────────────────────────────────

  it('experience_update changes evidence', async () => {
    const ts = createExperienceTools();
    const { id } = await addExperience(ts, { trigger: 'T', insight: 'I', evidence: 'old evidence' });
    await getTool(ts, 'experience_update').execute({ id, evidence: 'new evidence' }, makeCtx());
    const { experiences } = await listExperiences(ts);
    expect(experiences[0].evidence).toBe('new evidence');
  });

  it('experience_update changes tags', async () => {
    const ts = createExperienceTools();
    const { id } = await addExperience(ts, { trigger: 'T', insight: 'I', tags: ['old'] });
    await getTool(ts, 'experience_update').execute({ id, tags: ['new', 'updated'] }, makeCtx());
    const { experiences } = await listExperiences(ts);
    expect(experiences[0].tags).toEqual(['new', 'updated']);
  });

  it('experience_update clears tags when empty array is provided', async () => {
    const ts = createExperienceTools();
    const { id } = await addExperience(ts, { trigger: 'T', insight: 'I', tags: ['remove-me'] });
    await getTool(ts, 'experience_update').execute({ id, tags: [] }, makeCtx());
    const { experiences } = await listExperiences(ts);
    // tags should be undefined when empty
    expect(experiences[0].tags).toBeUndefined();
  });

  // ── onGetSystemPrompt for sub-agent ─────────────────────────────────────────

  it('onGetSystemPrompt returns undefined for sub-agent context', () => {
    const ts = createExperienceTools();
    const subCtx = { sessionId: 'sess-1', agentName: 'sub', conversationId: 'conv-1' };
    const prompt = ts.onGetSystemPrompt?.(subCtx, emptyPromptCtx, []);
    expect(prompt).toBeUndefined();
  });
});
