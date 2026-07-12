import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createToolStateToolSet, isToolStateToolSet, findToolStateToolSet } from '../agent';
import { MAIN_CONVERSATION_ID } from '@agent-type';
import type { Tool } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'session-1', agentName = 'main', conversationId = MAIN_CONVERSATION_ID) {
  return { sessionId, agentName, conversationId };
}

function makeTool(name: string, group?: string): Tool {
  return {
    name,
    description: `tool ${name}`,
    parameters: z.object({}),
    group,
    execute: async () => null,
  };
}

// ── createToolStateToolSet ────────────────────────────────────────────────────

describe('createToolStateToolSet', () => {
  // ── Shape ──────────────────────────────────────────────────────────────────

  it('returns a ToolSet with name "ToolState"', () => {
    const ts = createToolStateToolSet();
    expect(ts.name).toBe('ToolState');
  });

  it('has no tools of its own', () => {
    const ts = createToolStateToolSet();
    expect(ts.tools).toEqual([]);
  });

  it('satisfies isToolStateToolSet type guard', () => {
    const ts = createToolStateToolSet();
    expect(isToolStateToolSet(ts)).toBe(true);
  });

  it('findToolStateToolSet returns the instance from a list', () => {
    const ts = createToolStateToolSet();
    expect(findToolStateToolSet([ts])).toBe(ts);
  });

  it('findToolStateToolSet returns undefined when not in list', () => {
    expect(findToolStateToolSet([])).toBeUndefined();
  });

  // ── onFilterTools ──────────────────────────────────────────────────────────

  it('onFilterTools returns all tools when nothing is disabled', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('t1'), makeTool('t2')];
    const filtered = ts.onFilterTools!(ctx, tools);
    expect(filtered).toHaveLength(2);
  });

  it('onFilterTools caches tools for disableGroup use', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('t1', 'grp'), makeTool('t2', 'grp')];
    ts.onFilterTools!(ctx, tools);
    ts.disableGroup(ctx, 'grp');
    const disabled = ts.getDisabledNames(ctx);
    expect(disabled.has('t1')).toBe(true);
    expect(disabled.has('t2')).toBe(true);
  });

  it('onFilterTools excludes disabled tools', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('t1'), makeTool('t2'), makeTool('t3')];
    ts.onFilterTools!(ctx, tools);
    ts.disableNames(ctx, new Set(['t2']));
    const filtered = ts.onFilterTools!(ctx, tools);
    expect(filtered.map((t: Tool) => t.name)).not.toContain('t2');
    expect(filtered.map((t: Tool) => t.name)).toContain('t1');
    expect(filtered.map((t: Tool) => t.name)).toContain('t3');
  });

  // ── toggleTool ─────────────────────────────────────────────────────────────

  it('toggleTool disables an enabled tool', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.toggleTool(ctx, 'echo');
    expect(ts.getDisabledNames(ctx).has('echo')).toBe(true);
  });

  it('toggleTool re-enables a disabled tool', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.toggleTool(ctx, 'echo');
    ts.toggleTool(ctx, 'echo');
    expect(ts.getDisabledNames(ctx).has('echo')).toBe(false);
  });

  // ── disableNames / enableNames ─────────────────────────────────────────────

  it('disableNames disables multiple tools at once', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.disableNames(ctx, new Set(['a', 'b', 'c']));
    const disabled = ts.getDisabledNames(ctx);
    expect(disabled.has('a')).toBe(true);
    expect(disabled.has('b')).toBe(true);
    expect(disabled.has('c')).toBe(true);
  });

  it('enableNames re-enables previously disabled tools', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.disableNames(ctx, new Set(['a', 'b']));
    ts.enableNames(ctx, new Set(['a']));
    expect(ts.getDisabledNames(ctx).has('a')).toBe(false);
    expect(ts.getDisabledNames(ctx).has('b')).toBe(true);
  });

  // ── disableGroup / enableGroup ─────────────────────────────────────────────

  it('disableGroup disables all tools in a group', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('g1', 'G'), makeTool('g2', 'G'), makeTool('other')];
    ts.onFilterTools!(ctx, tools);
    ts.disableGroup(ctx, 'G');
    const disabled = ts.getDisabledNames(ctx);
    expect(disabled.has('g1')).toBe(true);
    expect(disabled.has('g2')).toBe(true);
    expect(disabled.has('other')).toBe(false);
  });

  it('disableGroup is a no-op when cache is empty', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    expect(() => ts.disableGroup(ctx, 'G')).not.toThrow();
    expect(ts.getDisabledNames(ctx).size).toBe(0);
  });

  it('enableGroup re-enables all tools in a group', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('g1', 'G'), makeTool('g2', 'G')];
    ts.onFilterTools!(ctx, tools);
    ts.disableGroup(ctx, 'G');
    ts.enableGroup(ctx, 'G');
    const disabled = ts.getDisabledNames(ctx);
    expect(disabled.has('g1')).toBe(false);
    expect(disabled.has('g2')).toBe(false);
  });

  // ── onInitSession ──────────────────────────────────────────────────────────

  it('onInitSession restores disabled tools from entryData.toolStates', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx('s1');
    ts.onInitSession!(ctx, {
      id: 's1',
      title: 'T',
      toolStates: { echo: false, search: true },
    });
    const disabled = ts.getDisabledNames(ctx);
    expect(disabled.has('echo')).toBe(true);
    expect(disabled.has('search')).toBe(false);
  });

  it('onInitSession ignores missing toolStates', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx('s1');
    expect(() => ts.onInitSession!(ctx, { id: 's1', title: 'T' })).not.toThrow();
    expect(ts.getDisabledNames(ctx).size).toBe(0);
  });

  // ── onRemoveSession ────────────────────────────────────────────────────────

  it('onRemoveSession clears disabled state for the session', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx('s1');
    ts.disableNames(ctx, new Set(['echo']));
    ts.onRemoveSession!(ctx);
    expect(ts.getDisabledNames(ctx).size).toBe(0);
  });

  it('onRemoveSession does not affect other sessions', () => {
    const ts = createToolStateToolSet();
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.disableNames(ctx1, new Set(['echo']));
    ts.disableNames(ctx2, new Set(['search']));
    ts.onRemoveSession!(ctx1);
    expect(ts.getDisabledNames(ctx2).has('search')).toBe(true);
  });

  // ── onGetSymbolState ───────────────────────────────────────────────────────

  it('onGetSymbolState returns toolStates with enabled=true for all tools', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('echo'), makeTool('search')];
    const state = ts.onGetSymbolState!(ctx, { tools });
    expect(state.toolStates.find((t) => t.name === 'echo')?.enabled).toBe(true);
    expect(state.toolStates.find((t) => t.name === 'search')?.enabled).toBe(true);
  });

  it('onGetSymbolState marks disabled tools with enabled=false', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.disableNames(ctx, new Set(['echo']));
    const tools = [makeTool('echo'), makeTool('search')];
    const state = ts.onGetSymbolState!(ctx, { tools });
    expect(state.toolStates.find((t) => t.name === 'echo')?.enabled).toBe(false);
    expect(state.toolStates.find((t) => t.name === 'search')?.enabled).toBe(true);
  });

  it('onGetSymbolState includes group in each entry', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('g1', 'Grp')];
    const state = ts.onGetSymbolState!(ctx, { tools });
    expect(state.toolStates[0].group).toBe('Grp');
  });

  // ── onSubscribe ────────────────────────────────────────────────────────────

  it('onSubscribe fires when a tool is toggled', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const fn = vi.fn();
    ts.onSubscribe!(ctx, fn);
    ts.toggleTool(ctx, 'echo');
    expect(fn).toHaveBeenCalled();
  });

  it('onSubscribe returns an unsubscribe function', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const fn = vi.fn();
    const unsub = ts.onSubscribe!(ctx, fn);
    unsub();
    ts.toggleTool(ctx, 'echo');
    expect(fn).not.toHaveBeenCalled();
  });

  // ── onBuildSnapshot ────────────────────────────────────────────────────────

  it('onBuildSnapshot returns empty object when no tools or state', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const snap = ts.onBuildSnapshot!(ctx);
    expect(snap).toEqual({});
  });

  it('onBuildSnapshot persists enabled/disabled states', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('echo'), makeTool('search')];
    ts.onFilterTools!(ctx, tools);
    ts.disableNames(ctx, new Set(['echo']));
    const snap = ts.onBuildSnapshot!(ctx) as { toolStates: Record<string, boolean> };
    expect(snap.toolStates['echo']).toBe(false);
    expect(snap.toolStates['search']).toBe(true);
  });

  // ── scope isolation ────────────────────────────────────────────────────────

  it('different sessions have independent disabled sets', () => {
    const ts = createToolStateToolSet();
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.disableNames(ctx1, new Set(['echo']));
    expect(ts.getDisabledNames(ctx2).has('echo')).toBe(false);
  });

  // ── onBeforeToolExecute ────────────────────────────────────────────────────

  it('onBeforeToolExecute blocks disabled tools with a failure result', async () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.disableNames(ctx, new Set(['echo']));
    const tool = makeTool('echo');
    const execCtx = { signal: new AbortController().signal } as any;
    const intercept = await ts.onBeforeToolExecute!(ctx, 'echo', tool, {}, execCtx);
    expect(intercept).toEqual({
      allow: false,
      result: {
        toolCallId: '',
        name: 'echo',
        result: { ok: false, error: 'Tool "echo" is currently disabled and cannot be executed.' },
      },
    });
  });

  it('onBeforeToolExecute allows enabled tools through', async () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tool = makeTool('echo');
    const execCtx = { signal: new AbortController().signal } as any;
    const intercept = await ts.onBeforeToolExecute!(ctx, 'echo', tool, {}, execCtx);
    expect(intercept).toEqual({ allow: true });
  });

  it('onBeforeToolExecute is per-session isolated', async () => {
    const ts = createToolStateToolSet();
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.disableNames(ctx1, new Set(['echo']));
    const tool = makeTool('echo');
    const execCtx = { signal: new AbortController().signal } as any;
    const intercept = await ts.onBeforeToolExecute!(ctx2, 'echo', tool, {}, execCtx);
    expect(intercept).toEqual({ allow: true });
  });

  it('re-enabling a disabled tool allows it to execute again', async () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.disableNames(ctx, new Set(['echo']));
    ts.enableNames(ctx, new Set(['echo']));
    const tool = makeTool('echo');
    const execCtx = { signal: new AbortController().signal } as any;
    const intercept = await ts.onBeforeToolExecute!(ctx, 'echo', tool, {}, execCtx);
    expect(intercept).toEqual({ allow: true });
  });
});
