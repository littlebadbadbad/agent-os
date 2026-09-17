// @ts-nocheck
/**
 * Tool-state app tests — default-off model.
 *
 * Covers: per-scope enabled sets (default: everything off), the resident
 * `manage_tools` batch switcher (atomic + validated), session-panel state
 * rendering data, snapshot persist/restore, execution gating, system-prompt
 * catalogue/suppression, the global (toolButton) lock, and resident-tool
 * immunity across every control surface.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createToolStateToolSet,
  createGlobalToolStore,
  createToolStateBridge,
  createToolStateSlots,
  MANAGE_TOOLS_NAME,
  isResident,
  TOOL_STATE_GUIDANCE,
  truncateDescription,
  DESCRIPTION_LIMIT,
} from '../agent';
import { MAIN_CONVERSATION_ID } from '@agent-type';
import type { Tool, ToolExecutionContext, ToolSetContext, AgentQueryFns } from '@agent-type';
import type { ToolStateEntry } from '../agent/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'session-1', agentName = 'main', conversationId = MAIN_CONVERSATION_ID): ToolSetContext {
  return { sessionId, agentName, conversationId };
}

function makeExecCtx(sessionId = 'session-1', agentName = 'main', conversationId = MAIN_CONVERSATION_ID): ToolExecutionContext {
  return {
    signal: new AbortController().signal,
    sessionId,
    agentName,
    conversationId,
    sourceAgent: agentName,
    isSubAgent: agentName !== 'main',
    toolCallId: 'call_00_test123',
  };
}

function makeTool(name: string, description?: string, group?: string): Tool {
  return {
    name,
    description: description ?? `tool ${name}`,
    parameters: z.object({}),
    group,
    execute: async () => null,
  };
}

/** The manage_tools tool instance carried by a ToolSet. */
function manageTools(ts): Tool {
  const tools = typeof ts.tools === 'function' ? ts.tools() : ts.tools;
  return tools.find((t: Tool) => t.name === MANAGE_TOOLS_NAME);
}

const POOL = () => [makeTool(MANAGE_TOOLS_NAME, 'manage tools', 'Tool State'), makeTool('alpha'), makeTool('beta', undefined, 'Git')];

function makePromptCtx() {
  return {
    userMessage: undefined,
    baseSystemPrompt: undefined,
    currentSystemPromptParts: [],
    suppressToolSetPrompt: vi.fn(),
  };
}

// ── toolMeta ──────────────────────────────────────────────────────────────────

describe('toolMeta', () => {
  it('manage_tools is the only resident tool', () => {
    expect(isResident(MANAGE_TOOLS_NAME)).toBe(true);
    expect(isResident('read_file')).toBe(false);
    expect(isResident('')).toBe(false);
  });
});

// ── prompt helpers ────────────────────────────────────────────────────────────

describe('prompt', () => {
  it('truncateDescription flattens whitespace', () => {
    expect(truncateDescription('a\n\n  b\t c')).toBe('a b c');
  });

  it('truncateDescription caps at DESCRIPTION_LIMIT with an ellipsis', () => {
    const long = 'x'.repeat(DESCRIPTION_LIMIT + 40);
    const out = truncateDescription(long);
    expect(out.length).toBe(DESCRIPTION_LIMIT);
    expect(out.endsWith('…')).toBe(true);
  });

  it('truncateDescription leaves short descriptions untouched', () => {
    expect(truncateDescription('short one')).toBe('short one');
  });
});

// ── createToolStateToolSet — shape ───────────────────────────────────────────

describe('createToolStateToolSet', () => {
  it('has name "ToolState" and carries the resident manage_tools tool', () => {
    const ts = createToolStateToolSet();
    expect(ts.name).toBe('ToolState');
    const manage = manageTools(ts);
    expect(manage).toBeDefined();
    expect(manage.group).toBe('Tool State');
  });

  // ── Default-off filtering ──────────────────────────────────────────────────

  it('onFilterTools keeps ONLY the resident tool on a fresh scope', () => {
    const ts = createToolStateToolSet();
    const filtered = ts.onFilterTools!(makeCtx(), POOL());
    expect(filtered.map((t: Tool) => t.name)).toEqual([MANAGE_TOOLS_NAME]);
  });

  it('enabled tools appear in the NEXT filter run', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.onFilterTools!(ctx, POOL());
    ts.toggleTool(ctx, 'alpha');
    const filtered = ts.onFilterTools!(ctx, POOL());
    expect(filtered.map((t: Tool) => t.name).sort()).toEqual(['alpha', MANAGE_TOOLS_NAME]);
  });

  it('scopes are isolated: enabling in one session does not affect another', () => {
    const ts = createToolStateToolSet();
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.onFilterTools!(ctx1, POOL());
    ts.onFilterTools!(ctx2, POOL());
    ts.toggleTool(ctx1, 'alpha');
    expect(ts.onFilterTools!(ctx1, POOL()).map((t: Tool) => t.name)).toContain('alpha');
    expect(ts.onFilterTools!(ctx2, POOL()).map((t: Tool) => t.name)).not.toContain('alpha');
  });

  // ── toggleTool ─────────────────────────────────────────────────────────────

  it('toggleTool flips a tool on, then off again', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.onFilterTools!(ctx, POOL());
    ts.toggleTool(ctx, 'alpha');
    expect(ts.onGetSymbolState!(ctx).toolStates.find((e: ToolStateEntry) => e.name === 'alpha').enabled).toBe(true);
    ts.toggleTool(ctx, 'alpha');
    expect(ts.onGetSymbolState!(ctx).toolStates.find((e: ToolStateEntry) => e.name === 'alpha').enabled).toBe(false);
  });

  it('toggleTool refuses to toggle the resident tool', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.onFilterTools!(ctx, POOL());
    ts.toggleTool(ctx, MANAGE_TOOLS_NAME);
    // Still visible — resident tools are immune to panel toggling.
    expect(ts.onGetSymbolState!(ctx).toolStates.find((e: ToolStateEntry) => e.name === MANAGE_TOOLS_NAME).enabled).toBe(true);
  });

  it('toggleTool refuses to toggle a globally-locked tool', () => {
    const store = createGlobalToolStore();
    const ts = createToolStateToolSet(store);
    store.disable('alpha');
    const ctx = makeCtx();
    ts.onFilterTools!(ctx, POOL());
    ts.toggleTool(ctx, 'alpha'); // would enable — refused
    expect(ts.onGetSymbolState!(ctx).toolStates.find((e: ToolStateEntry) => e.name === 'alpha')).toMatchObject({
      enabled: false,
      locked: true,
    });
  });

  // ── manage_tools batch ─────────────────────────────────────────────────────

  describe('manage_tools', () => {
    it('enables tools atomically and reports the resulting state', async () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const result = await manageTools(ts).execute({ enable: ['alpha', 'beta'] }, makeExecCtx());
      expect(result.errors).toEqual([]);
      expect(result.enabled.sort()).toEqual(['alpha', 'beta', MANAGE_TOOLS_NAME]);
      expect(result.disabled).toEqual([]);
      // Visible from the next filter run onwards.
      expect(ts.onFilterTools!(ctx, POOL())).toHaveLength(3);
    });

    it('disables previously enabled tools', async () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      await manageTools(ts).execute({ enable: ['alpha', 'beta'] }, makeExecCtx());
      const result = await manageTools(ts).execute({ disable: ['beta'] }, makeExecCtx());
      expect(result.errors).toEqual([]);
      expect(result.enabled.sort()).toEqual(['alpha', MANAGE_TOOLS_NAME]);
      expect(result.disabled).toEqual(['beta']);
    });

    it('rejects unknown names and applies NOTHING (atomic)', async () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const result = await manageTools(ts).execute({ enable: ['alpha', 'nope'] }, makeExecCtx());
      expect(result.errors).toEqual(['Unknown tool "nope".']);
      // The valid half of the batch was NOT applied either.
      expect(ts.onFilterTools!(ctx, POOL()).map((t: Tool) => t.name)).toEqual([MANAGE_TOOLS_NAME]);
    });

    it('refuses to enable a globally-disabled tool', async () => {
      const store = createGlobalToolStore();
      const ts = createToolStateToolSet(store);
      store.disable('alpha');
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const result = await manageTools(ts).execute({ enable: ['alpha'] }, makeExecCtx());
      expect(result.errors).toEqual([
        'Tool "alpha" is globally disabled by the user and cannot be enabled.',
      ]);
      expect(ts.onFilterTools!(ctx, POOL()).map((t: Tool) => t.name)).toEqual([MANAGE_TOOLS_NAME]);
    });

    it('refuses to disable the resident tool', async () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const result = await manageTools(ts).execute({ disable: [MANAGE_TOOLS_NAME] }, makeExecCtx());
      expect(result.errors).toEqual(['Tool "manage_tools" is resident and cannot be disabled.']);
    });

    it('treats enabling the resident tool as a harmless no-op', async () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const result = await manageTools(ts).execute({ enable: [MANAGE_TOOLS_NAME] }, makeExecCtx());
      expect(result.errors).toEqual([]);
    });

    it('rejects a name appearing in both enable and disable', async () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const result = await manageTools(ts).execute({ enable: ['alpha'], disable: ['alpha'] }, makeExecCtx());
      expect(result.errors).toEqual(['Tool "alpha" appears in both `enable` and `disable`.']);
      expect(ts.onFilterTools!(ctx, POOL()).map((t: Tool) => t.name)).toEqual([MANAGE_TOOLS_NAME]);
    });

    it('requires at least one name', async () => {
      const ts = createToolStateToolSet();
      const result = await manageTools(ts).execute({}, makeExecCtx());
      expect(result.errors).toEqual(['Provide at least one name in `enable` or `disable`.']);
      expect(result.enabled).toEqual([]);
    });

    it('addresses the CALLING scope, not the last attached agent', async () => {
      // Regression: the UI registers one ToolSet instance on several agents;
      // manage_tools must mutate the scope of the exec context it was called with.
      const ts = createToolStateToolSet();
      const ctxA = makeCtx('sa', 'stream-agent');
      const ctxB = makeCtx('sb', 'async-agent');
      ts.onFilterTools!(ctxA, POOL());
      ts.onFilterTools!(ctxB, POOL());
      await manageTools(ts).execute({ enable: ['alpha'] }, makeExecCtx('sa', 'stream-agent'));
      expect(ts.onFilterTools!(ctxA, POOL()).map((t: Tool) => t.name)).toContain('alpha');
      expect(ts.onFilterTools!(ctxB, POOL()).map((t: Tool) => t.name)).not.toContain('alpha');
    });

    it('notifies subscribers so panels refresh after a batch', async () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const fn = vi.fn();
      ts.onSubscribe!(ctx, fn);
      await manageTools(ts).execute({ enable: ['alpha'] }, makeExecCtx());
      expect(fn).toHaveBeenCalled();
    });
  });

  // ── Snapshot persist / restore ─────────────────────────────────────────────

  describe('persistence', () => {
    it('onBuildSnapshot returns {} for a scope with no pool and no state', () => {
      const ts = createToolStateToolSet();
      expect(ts.onBuildSnapshot!(makeCtx())).toEqual({});
    });

    it('onBuildSnapshot records enabled=true, disabled=false, resident=true', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      ts.toggleTool(ctx, 'alpha');
      const snap = ts.onBuildSnapshot!(ctx);
      expect(snap.toolStates).toEqual({
        [MANAGE_TOOLS_NAME]: true,
        alpha: true,
        beta: false,
      });
    });

    it('onBuildSnapshot keeps enabled names that are outside the cached pool', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onInit!(ctx, { id: 'session-1', toolStates: { ghost: true } });
      const snap = ts.onBuildSnapshot!(ctx);
      expect(snap.toolStates).toEqual({ ghost: true });
    });

    it('onInit restores the saved enabled set (default-off only without state)', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onInit!(ctx, { id: 'session-1', toolStates: { alpha: true, beta: false } });
      const filtered = ts.onFilterTools!(ctx, POOL());
      expect(filtered.map((t: Tool) => t.name).sort()).toEqual(['alpha', MANAGE_TOOLS_NAME]);
    });

    it('onInit without toolStates leaves the scope fully off', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      expect(() => ts.onInit!(ctx, { id: 'session-1' })).not.toThrow();
      expect(ts.onFilterTools!(ctx, POOL()).map((t: Tool) => t.name)).toEqual([MANAGE_TOOLS_NAME]);
    });

    it('round-trip: snapshot from one ToolSet restores identically in the next', () => {
      const ts1 = createToolStateToolSet();
      const ctx = makeCtx();
      ts1.onFilterTools!(ctx, POOL());
      ts1.toggleTool(ctx, 'beta');
      const snap = ts1.onBuildSnapshot!(ctx);

      const ts2 = createToolStateToolSet();
      ts2.onInit!(ctx, { id: 'session-1', ...snap });
      expect(ts2.onFilterTools!(ctx, POOL()).map((t: Tool) => t.name).sort()).toEqual([
        'beta',
        MANAGE_TOOLS_NAME,
      ]);
    });
  });

  it('onRemove clears every per-scope map entry', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.onFilterTools!(ctx, POOL());
    ts.toggleTool(ctx, 'alpha');
    ts.onRemove!(ctx);
    // Fresh scope again: only the resident tool survives the filter.
    expect(ts.onFilterTools!(ctx, POOL()).map((t: Tool) => t.name)).toEqual([MANAGE_TOOLS_NAME]);
  });

  // ── onGetSymbolState (session panel data) ─────────────────────────────────

  describe('onGetSymbolState', () => {
    it('lists every pool tool with enabled/locked/resident flags', () => {
      const store = createGlobalToolStore();
      const ts = createToolStateToolSet(store);
      store.disable('beta');
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      ts.toggleTool(ctx, 'alpha');
      const state = ts.onGetSymbolState!(ctx);
      const byName = Object.fromEntries(state.toolStates.map((e: ToolStateEntry) => [e.name, e]));
      expect(byName[MANAGE_TOOLS_NAME]).toMatchObject({ enabled: true, locked: false, resident: true });
      expect(byName.alpha).toMatchObject({ enabled: true, locked: false, resident: false, group: undefined });
      expect(byName.beta).toMatchObject({ enabled: false, locked: true, resident: false, group: 'Git' });
    });

    it('falls back to the cached pool when stateCtx.tools is absent', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      expect(ts.onGetSymbolState!(ctx).toolStates).toHaveLength(3);
    });

    it('exposes a scope-bound toggleTool', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const state = ts.onGetSymbolState!(ctx);
      state.toggleTool('alpha');
      expect(ts.onGetSymbolState!(ctx).toolStates.find((e: ToolStateEntry) => e.name === 'alpha').enabled).toBe(true);
    });
  });

  // ── onSubscribe ────────────────────────────────────────────────────────────

  it('onSubscribe fires on toggle and stops after unsubscribe', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const fn = vi.fn();
    const unsub = ts.onSubscribe!(ctx, fn);
    ts.toggleTool(ctx, 'alpha');
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    ts.toggleTool(ctx, 'beta');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── onBeforeToolExecute ────────────────────────────────────────────────────

  describe('onBeforeToolExecute', () => {
    it('blocks a never-enabled tool with the exact failure result', async () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const intercept = await ts.onBeforeToolExecute!(ctx, 'alpha', makeTool('alpha'), {}, makeExecCtx());
      expect(intercept).toEqual({
        allow: false,
        result: {
          toolCallId: 'call_00_test123',
          name: 'alpha',
          result: { ok: false, error: 'Tool "alpha" is currently disabled.' },
        },
      });
    });

    it('allows the resident tool and enabled tools through', async () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      expect(await ts.onBeforeToolExecute!(ctx, MANAGE_TOOLS_NAME, makeTool(MANAGE_TOOLS_NAME), {}, makeExecCtx())).toEqual({ allow: true });
      ts.toggleTool(ctx, 'alpha');
      expect(await ts.onBeforeToolExecute!(ctx, 'alpha', makeTool('alpha'), {}, makeExecCtx())).toEqual({ allow: true });
    });

    it('blocks a globally-locked tool even when enabled at the scope', async () => {
      const store = createGlobalToolStore();
      const ts = createToolStateToolSet(store);
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      ts.toggleTool(ctx, 'alpha');
      store.disable('alpha'); // locked AFTER being enabled
      const intercept = await ts.onBeforeToolExecute!(ctx, 'alpha', makeTool('alpha'), {}, makeExecCtx());
      expect(intercept).toMatchObject({ allow: false });
    });
  });

  // ── onGetSystemPrompt ──────────────────────────────────────────────────────

  describe('onGetSystemPrompt', () => {
    it('lists hidden enable-able tools grouped with truncated descriptions', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      const pool = [
        makeTool(MANAGE_TOOLS_NAME),
        makeTool('alpha', 'Does alpha things', 'Files'),
        makeTool('beta', 'B'.repeat(DESCRIPTION_LIMIT + 30), 'Files'),
      ];
      ts.onFilterTools!(ctx, pool);
      ts.toggleTool(ctx, 'alpha'); // now visible → leaves the catalogue

      const out = ts.onGetSystemPrompt!(ctx, makePromptCtx(), []) ?? '';
      expect(out).toContain(TOOL_STATE_GUIDANCE);
      expect(out).toContain('`beta`');
      expect(out).toContain('- **Files**');
      expect(out).not.toContain('`alpha`'); // enabled tools are not listed
      expect(out).not.toContain('  - `manage_tools`'); // resident never appears in the catalogue
      // Long description truncated to DESCRIPTION_LIMIT chars inside the line.
      expect(out).toContain('…');
      expect(out).not.toContain('B'.repeat(DESCRIPTION_LIMIT + 1));
    });

    it('excludes globally-locked tools from the catalogue', () => {
      const store = createGlobalToolStore();
      const ts = createToolStateToolSet(store);
      store.disable('beta');
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      const out = ts.onGetSystemPrompt!(ctx, makePromptCtx(), []) ?? '';
      expect(out).toContain('`alpha`');
      expect(out).not.toContain('`beta`');
    });

    it('returns undefined when nothing enable-able is hidden', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      ts.toggleTool(ctx, 'alpha');
      ts.toggleTool(ctx, 'beta');
      expect(ts.onGetSystemPrompt!(ctx, makePromptCtx(), [])).toBeUndefined();
    });

    it('suppresses the prompt of fully-hidden ToolSets only', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      ts.onFilterTools!(ctx, POOL());
      ts.toggleTool(ctx, 'alpha');

      const hiddenSet = { name: 'Hidden', tools: [makeTool('beta')] } as unknown as ToolSet;
      const partialSet = { name: 'Partial', tools: [makeTool('alpha'), makeTool('nope')] } as unknown as ToolSet;
      const emptySet = { name: 'Empty', tools: [] } as unknown as ToolSet;
      const selfSet = { name: 'ToolState', tools: [makeTool(MANAGE_TOOLS_NAME)] } as unknown as ToolSet;
      const promptCtx = makePromptCtx();

      ts.onGetSystemPrompt!(ctx, promptCtx, [hiddenSet, partialSet, emptySet, selfSet]);
      expect(promptCtx.suppressToolSetPrompt).toHaveBeenCalledWith('Hidden');
      expect(promptCtx.suppressToolSetPrompt).not.toHaveBeenCalledWith('Partial');
      expect(promptCtx.suppressToolSetPrompt).not.toHaveBeenCalledWith('Empty');
      expect(promptCtx.suppressToolSetPrompt).not.toHaveBeenCalledWith('ToolState');
    });

    it('handles factory-function descriptions in the catalogue', () => {
      const ts = createToolStateToolSet();
      const ctx = makeCtx();
      const tool: Tool = {
        name: 'dyn',
        description: () => 'dynamic description',
        parameters: z.object({}),
        execute: async () => null,
      };
      ts.onFilterTools!(ctx, [makeTool(MANAGE_TOOLS_NAME), tool]);
      const out = ts.onGetSystemPrompt!(ctx, makePromptCtx(), []) ?? '';
      expect(out).toContain('`dyn` — dynamic description');
    });
  });

  // ── Multi-agent pool union ─────────────────────────────────────────────────

  it('getToolPool unions the tools of every attached agent, deduped by name', () => {
    const ts = createToolStateToolSet();
    ts.onAttach?.({
      id: 'stream',
      getTools: () => [makeTool('a'), makeTool('shared')],
      getRegisteredToolSets: () => [],
    } as unknown as AgentQueryFns);
    ts.onAttach?.({
      id: 'async',
      getTools: () => [makeTool('b'), makeTool('shared')],
      getRegisteredToolSets: () => [],
    } as unknown as AgentQueryFns);
    expect(ts.getToolPool().map((t: Tool) => t.name).sort()).toEqual(['a', 'b', 'shared']);
  });

  it('manage_tools falls back to the global pool before any filter run', async () => {
    const ts = createToolStateToolSet();
    ts.onAttach?.({
      id: 'main',
      getTools: () => [makeTool(MANAGE_TOOLS_NAME), makeTool('zeta')],
      getRegisteredToolSets: () => [],
    } as unknown as AgentQueryFns);
    // No onFilterTools yet — batch validation uses the union pool.
    const result = await manageTools(ts).execute({ enable: ['zeta'] }, makeExecCtx());
    expect(result.errors).toEqual([]);
    expect(result.enabled).toContain('zeta');
  });
});

// ── Global (toolButton) lock ─────────────────────────────────────────────────

describe('global tool store', () => {
  it('toggle flips state, notifies subscribers, returns new disabled flag', () => {
    const store = createGlobalToolStore();
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    expect(store.toggle('a')).toBe(true);
    expect(store.isDisabled('a')).toBe(true);
    expect(store.toggle('a')).toBe(false);
    expect(store.isDisabled('a')).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
    store.toggle('a');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('disable/enable/setDisabled are idempotent and only notify on change', () => {
    const store = createGlobalToolStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.disable('a');
    store.disable('a');
    expect(fn).toHaveBeenCalledTimes(1);
    store.setDisabled(['a', 'b']);
    expect(store.getDisabled()).toEqual(['a', 'b']);
    store.setDisabled(['b', 'a']); // same set, no change
    expect(fn).toHaveBeenCalledTimes(2);
    store.enable('a');
    expect(store.size()).toBe(1);
  });

  it('the resident tool can never enter the disabled set', () => {
    const store = createGlobalToolStore();
    store.disable(MANAGE_TOOLS_NAME);
    expect(store.isDisabled(MANAGE_TOOLS_NAME)).toBe(false);
    expect(store.toggle(MANAGE_TOOLS_NAME)).toBe(false);
    store.setDisabled([MANAGE_TOOLS_NAME, 'a']);
    expect(store.getDisabled()).toEqual(['a']);
  });
});

describe('toolButton bridge', () => {
  it('lists the global pool WITHOUT the resident tool', () => {
    const store = createGlobalToolStore();
    const pool = [makeTool(MANAGE_TOOLS_NAME), makeTool('a', 'A tool', 'G1'), makeTool('b')];
    const bridge = createToolStateBridge(store, () => pool);
    store.disable('b');
    const states = bridge.getGlobalToolStates();
    expect(states).toHaveLength(2);
    expect(states.find((s) => s.name === 'a')).toMatchObject({ enabled: true, group: 'G1' });
    expect(states.find((s) => s.name === 'b')?.enabled).toBe(false);
    expect(states.some((s) => s.name === MANAGE_TOOLS_NAME)).toBe(false);
    expect(bridge.getGlobalDisabledCount()).toBe(1);
    expect(bridge.isGloballyDisabled('b')).toBe(true);
  });

  it('toggleGlobal / setGlobalDisabled / subscribeGlobal proxy the store', () => {
    const store = createGlobalToolStore();
    const bridge = createToolStateBridge(store, () => []);
    const fn = vi.fn();
    bridge.subscribeGlobal(fn);
    expect(bridge.toggleGlobal('x')).toBe(true);
    expect(bridge.getGlobalDisabled()).toEqual(['x']);
    bridge.setGlobalDisabled([]);
    expect(store.size()).toBe(0);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('global lock enforcement in ToolSet', () => {
  function makeLockedSet() {
    const store = createGlobalToolStore();
    const ts = createToolStateToolSet(store);
    return { store, ts };
  }

  it('onFilterTools removes globally-disabled tools in EVERY scope', () => {
    const { store, ts } = makeLockedSet();
    store.disable('alpha');
    const expect1 = ts.onFilterTools!(makeCtx('s1'), POOL()).map((t: Tool) => t.name);
    const expect2 = ts.onFilterTools!(makeCtx('s2'), POOL()).map((t: Tool) => t.name);
    expect(expect1).toEqual([MANAGE_TOOLS_NAME]);
    expect(expect2).toEqual([MANAGE_TOOLS_NAME]);
  });

  it('a global disable refreshes every subscribed scope', () => {
    const { store, ts } = makeLockedSet();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    ts.onSubscribe!(makeCtx('s1'), fn1);
    ts.onSubscribe!(makeCtx('s2'), fn2);
    store.disable('alpha');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('resuming a saved session keeps enabled names that were later locked out', () => {
    const { store, ts } = makeLockedSet();
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', toolStates: { alpha: true } });
    store.disable('alpha');
    // Lock wins over the restored enabled set — visibility is derived, not stored.
    expect(ts.onFilterTools!(ctx, POOL()).map((t: Tool) => t.name)).toEqual([MANAGE_TOOLS_NAME]);
  });
});

// ── Slot declarations ────────────────────────────────────────────────────────

describe('slot declarations', () => {
  it('declares a panel slot and a session-independent toolButton slot', () => {
    const store = createGlobalToolStore();
    const slots = createToolStateSlots(store);
    const panel = slots.find((s) => s.type === 'panel');
    const button = slots.find((s) => s.type === 'toolButton');
    expect(panel).toBeDefined();
    expect(button).toMatchObject({ type: 'toolButton', label: 'Tools', showBtn: expect.any(Function) });
    // Badge counts globally-disabled tools from the closure store — with no
    // session state at all.
    expect(button.badge({ sessionId: '', agentName: '', conversationId: '' }, undefined)).toBeNull();
    store.disable('x');
    expect(button.badge({ sessionId: '', agentName: '', conversationId: '' }, undefined)).toBe('off 1');
  });
});
