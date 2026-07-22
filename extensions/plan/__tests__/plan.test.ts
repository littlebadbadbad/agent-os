import { describe, it, expect } from 'vitest';
import { createPlanToolSet, getPlanSlotDeclarations } from '../agent/toolSet';
import { resolveToolSetTools, MAIN_CONVERSATION_ID } from '@agent-type';
import type { ToolSetContext } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'session-1') {
  return {
    sessionId,
    agentName: 'main',
    conversationId: MAIN_CONVERSATION_ID,
    signal: new AbortController().signal,
  };
}

function makeTsCtx(sessionId = 'session-1'): ToolSetContext {
  return { sessionId, agentName: 'main', conversationId: MAIN_CONVERSATION_ID };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createPlanToolSet', () => {
  // ── ToolSet shape ─────────────────────────────────────────────────────────

  it('returns a ToolSet with name "plan"', () => {
    const ts = createPlanToolSet();
    expect(ts.name).toBe('plan');
  });

  it('exports exactly five tools: plan_write, plan_checkpoint, plan_enter, plan_exit, plan_verify', () => {
    const ts = createPlanToolSet();
    const names = resolveToolSetTools(ts).map((t) => t.name);
    expect(names).toContain('plan_write');
    expect(names).toContain('plan_checkpoint');
    expect(names).toContain('plan_enter');
    expect(names).toContain('plan_exit');
    expect(names).toContain('plan_verify');
    expect(resolveToolSetTools(ts)).toHaveLength(5);
  });

  it('has coreTools covering all five tools', () => {
    const ts = createPlanToolSet();
    expect(ts.coreTools).toContain('plan_write');
    expect(ts.coreTools).toContain('plan_checkpoint');
    expect(ts.coreTools).toContain('plan_enter');
    expect(ts.coreTools).toContain('plan_exit');
    expect(ts.coreTools).toContain('plan_verify');
  });

  // ── plan_write ───────────────────────────────────────────────────────────

  it('plan_write stores and retrieves plan content', async () => {
    const ts = createPlanToolSet();
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_write')!;

    const result = await writeTool.execute(
      { content: '# Test Plan\n\n## Goal\nDo something.' },
      makeCtx(),
    );
    expect(result).toEqual({ success: true });

    // Verify via onGetSymbolState
    const state = ts.onGetSymbolState!(makeTsCtx());
    expect(state.plan).toBe('# Test Plan\n\n## Goal\nDo something.');
  });

  it('plan_write overwrites previous plan content', async () => {
    const ts = createPlanToolSet();
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_write')!;

    await writeTool.execute({ content: 'Plan A' }, makeCtx());
    await writeTool.execute({ content: 'Plan B' }, makeCtx());

    const state = ts.onGetSymbolState!(makeTsCtx());
    expect(state.plan).toBe('Plan B');
  });

  // ── plan_enter / plan_exit ───────────────────────────────────────────────

  it('plan_enter sets planMode to true', async () => {
    const ts = createPlanToolSet();
    const enterTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_enter')!;

    const result = await enterTool.execute({}, makeCtx());
    expect(result).toEqual({
      status: 'plan_mode_entered',
      message: expect.stringContaining('plan mode'),
    });

    const state = ts.onGetSymbolState!(makeTsCtx());
    expect(state.planMode).toBe(true);
  });

  it('plan_exit returns awaiting_input and clears planMode', async () => {
    const ts = createPlanToolSet();
    const ctx = makeCtx('session-plan-exit');
    const tsCtx = makeTsCtx('session-plan-exit');
    const enterTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_enter')!;
    const exitTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_exit')!;

    // Enter plan mode, write plan
    await enterTool.execute({}, ctx);
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_write')!;
    await writeTool.execute({ content: 'Plan content' }, ctx);

    const stateBefore = ts.onGetSymbolState!(tsCtx);
    expect(stateBefore.planMode).toBe(true);

    // Exit — now uses detached mode, returns awaiting_input immediately
    const exitResult = await exitTool.execute({}, ctx);
    expect(exitResult).toMatchObject({ status: 'awaiting_input' });

    // planMode should be cleared
    const stateAfter = ts.onGetSymbolState!(tsCtx);
    expect(stateAfter.planMode).toBe(false);
  });

  // ── plan_verify ──────────────────────────────────────────────────────────

  it('plan_verify counts steps from the plan markdown', async () => {
    const ts = createPlanToolSet();
    const verifyTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_verify')!;

    const planText = '# Plan\n## Steps\n1. First step\n2. Second step\n3. Third step';
    const result = await verifyTool.execute(
      { plan: planText, completed: ['First step'] },
      makeCtx(),
    );
    expect(result).toEqual({
      total: 3,
      completed: 1,
      pending: 2,
      steps: [
        { description: 'First step', done: true },
        { description: 'Second step', done: false },
        { description: 'Third step', done: false },
      ],
    });
  });

  it('plan_verify falls back to stored plan when no plan argument', async () => {
    const ts = createPlanToolSet();
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_write')!;
    const verifyTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_verify')!;

    await writeTool.execute({ content: '# Plan\n1. A\n2. B' }, makeCtx());

    const result = await verifyTool.execute({}, makeCtx());
    expect((result as Record<string, unknown>).total).toBe(2);
    expect((result as Record<string, unknown>).completed).toBe(0);
    expect((result as Record<string, unknown>).pending).toBe(2);
  });

  // ── onFilterTools (plan mode) ────────────────────────────────────────────

  it('onFilterTools restricts to PLAN_MODE_ALLOWED when planMode is active', async () => {
    const ts = createPlanToolSet();
    const enterTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_enter')!;
    await enterTool.execute({}, makeCtx());

    const allTools = [
      { name: 'plan_write' },
      { name: 'delete_file' },
      { name: 'read_file' },
      { name: 'unknown_tool' },
      { name: 'plan_exit' },
    ] as const;

    const filtered = ts.onFilterTools!(makeTsCtx(), allTools as Parameters<NonNullable<typeof ts.onFilterTools>>[1]);
    const names = filtered.map((t: { readonly name: string }) => t.name);

    expect(names).toContain('plan_write');
    expect(names).toContain('plan_exit');
    expect(names).toContain('read_file');
    expect(names).not.toContain('delete_file');
    expect(names).not.toContain('unknown_tool');
  });

  it('onFilterTools passes through all tools when not in plan mode', () => {
    const ts = createPlanToolSet();
    // Use a unique session ID to avoid state leakage from other tests
    const ctx = makeTsCtx('session-filter-pass');

    const allTools = [
      { name: 'plan_write' },
      { name: 'delete_file' },
      { name: 'unknown_tool' },
    ] as const;

    const filtered = ts.onFilterTools!(ctx, allTools as Parameters<NonNullable<typeof ts.onFilterTools>>[1]);
    expect(filtered).toHaveLength(3);
  });

  // ── onGetSystemPrompt ────────────────────────────────────────────────────

  it('onGetSystemPrompt returns planning guidance when no plan exists', () => {
    const ts = createPlanToolSet();
    // Use a unique session ID to avoid state leakage from other tests
    const ctx = makeTsCtx('session-prompt-empty');
    const prompt = ts.onGetSystemPrompt!(ctx);
    expect(prompt).toContain('Planning');
    expect(prompt).toContain('plan_write');
  });

  it('onGetSystemPrompt returns plan content with checkpoint hint when plan exists', async () => {
    const ts = createPlanToolSet();
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_write')!;
    await writeTool.execute({ content: '# My Plan' }, makeCtx());

    const prompt = ts.onGetSystemPrompt!(makeTsCtx());
    expect(prompt).toContain('# My Plan');
    expect(prompt).toContain('Current Plan');
  });

  it('onGetSystemPrompt warns about plan mode when active', async () => {
    const ts = createPlanToolSet();
    const enterTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_enter')!;
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_write')!;

    await enterTool.execute({}, makeCtx());
    await writeTool.execute({ content: '# Plan Draft' }, makeCtx());

    const prompt = ts.onGetSystemPrompt!(makeTsCtx());
    expect(prompt).toContain('Plan Mode Active');
    expect(prompt).toContain('plan_exit');
  });

  // ── Session lifecycle ────────────────────────────────────────────────────

  it('onInit restores plan and planMode from entryData', () => {
    const ts = createPlanToolSet();
    ts.onInit!(makeTsCtx(), {
      plan: '# Restored Plan',
      planMode: true,
    });

    const state = ts.onGetSymbolState!(makeTsCtx());
    expect(state.plan).toBe('# Restored Plan');
    expect(state.planMode).toBe(true);
  });

  it('onReset clears plan content and plan mode', async () => {
    const ts = createPlanToolSet();
    const enterTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_enter')!;
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_write')!;

    await enterTool.execute({}, makeCtx());
    await writeTool.execute({ content: 'Some plan' }, makeCtx());

    ts.onReset!(makeTsCtx());

    const state = ts.onGetSymbolState!(makeTsCtx());
    expect(state.plan).toBeUndefined();
    expect(state.planMode).toBe(false);
  });

  // ── onBuildSnapshot ─────────────────────────────────────────────────────

  it('onBuildSnapshot serializes plan content and planMode', async () => {
    const ts = createPlanToolSet();
    const enterTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_enter')!;
    const writeTool = resolveToolSetTools(ts).find((t) => t.name === 'plan_write')!;

    await enterTool.execute({}, makeCtx());
    await writeTool.execute({ content: 'Snapshot test' }, makeCtx());

    const snapshot = ts.onBuildSnapshot!(makeTsCtx());
    expect(snapshot).toEqual({ plan: 'Snapshot test', planMode: true });
  });

  it('onBuildSnapshot returns empty object when no plan stored', () => {
    const ts = createPlanToolSet();
    // Use a unique session ID to avoid state leakage from other tests
    const snapshot = ts.onBuildSnapshot!(makeTsCtx('session-snapshot-empty'));
    expect(snapshot).toEqual({});
  });

  // ── Slot declarations ────────────────────────────────────────────────────

  it('getPlanSlotDeclarations returns slot declarations (panel, toolCard, compactToolCard)', () => {
    const ts = createPlanToolSet();
    const toolNames = resolveToolSetTools(ts).map((t) => t.name);
    const slots = getPlanSlotDeclarations(toolNames);
    expect(slots).toHaveLength(3);

    const types = slots.map((s) => s.type);
    expect(types).toContain('panel');
    expect(types).toContain('toolCard');
    expect(types).toContain('compactToolCard');
  });
});
