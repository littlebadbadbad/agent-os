import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createToolLifecycle } from '../../client/toolLifecycle';
import { createToolManager } from '../../client/toolManager';
import { MAIN_CONVERSATION_ID } from '../../tools/toolSet';
import type { Tool } from '@agent-type';
import type { ToolSet, AgentClientLike } from '@agent-type';

const AGENT_ID = 'main';
function makeTsCtx(sessionId: string) {
  return { sessionId, agentName: AGENT_ID, conversationId: MAIN_CONVERSATION_ID };
}

/** Minimal AgentClientLike stub — enough for onAttach calls in tests. */
const stubAgentClient: AgentClientLike = {
  registerTool: vi.fn(() => () => {}),
  registerToolSet: vi.fn(() => () => {}),
  getTools: () => [],
  getFilteredTools: () => [],
  getRegisteredToolSets: () => [],
  handler: vi.fn() as any,
};

const getAgentClient = () => stubAgentClient;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTool(name: string, group?: string): Tool {
  return {
    name,
    description: `tool-${name}`,
    parameters: z.object({}),
    group,
    execute: async () => null,
  };
}

function makeSlots(...ids: string[]) {
  const slots = new Map<string, ReturnType<typeof createToolManager>>();
  for (const id of ids) slots.set(id, createToolManager({ id, title: `Session ${id}` }));
  return slots;
}

function makeSessionMgr(sessionIds: string[]) {
  return {
    getState: () => ({
      sessions: sessionIds.map((id) => ({
        id,
        title: `Session ${id}`,
        subtitle: '',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        session: {} as never,
      })),
      activeSessionId: sessionIds[0],
    }),
  };
}

// ── createToolLifecycle ───────────────────────────────────────────────────────

describe('createToolLifecycle', () => {
  // ── registerTool ───────────────────────────────────────────────────────────

  it('adds the tool to masterTools and all slots', () => {
    const masterTools: Tool[] = [];
    const slots = makeSlots('s1', 's2');
    const lc = createToolLifecycle({ masterTools, masterToolSets: [], slots, sessionMgr: makeSessionMgr(['s1', 's2']), getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    lc.registerTool(makeTool('echo'));

    expect(masterTools.map((t) => t.name)).toContain('echo');
    expect(slots.get('s1')!.getRegistry().has('echo')).toBe(true);
    expect(slots.get('s2')!.getRegistry().has('echo')).toBe(true);
  });

  it('returns an unregister callback that removes the tool everywhere', () => {
    const masterTools: Tool[] = [];
    const slots = makeSlots('s1');
    const lc = createToolLifecycle({ masterTools, masterToolSets: [], slots, sessionMgr: makeSessionMgr(['s1']), getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const unregister = lc.registerTool(makeTool('echo'));
    unregister();

    expect(masterTools).toHaveLength(0);
    expect(slots.get('s1')!.getRegistry().has('echo')).toBe(false);
  });

  it('unregister is idempotent (second call is harmless)', () => {
    const masterTools: Tool[] = [];
    const slots = makeSlots('s1');
    const lc = createToolLifecycle({ masterTools, masterToolSets: [], slots, sessionMgr: makeSessionMgr(['s1']), getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });
    const unregister = lc.registerTool(makeTool('echo'));
    unregister();
    expect(() => unregister()).not.toThrow();
  });

  // ── registerTools (batch) ──────────────────────────────────────────────────

  it('registerTools adds multiple tools to masterTools and slots', () => {
    const masterTools: Tool[] = [];
    const slots = makeSlots('s1');
    const lc = createToolLifecycle({ masterTools, masterToolSets: [], slots, sessionMgr: makeSessionMgr(['s1']), getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const unregister = lc.registerTools([makeTool('a'), makeTool('b')]);

    expect(masterTools.map((t) => t.name)).toEqual(['a', 'b']);
    expect(slots.get('s1')!.getRegistry().has('a')).toBe(true);
    expect(slots.get('s1')!.getRegistry().has('b')).toBe(true);
    expect(lc.getTools().map((t) => t.name)).toContain('a');

    // cleanup
    unregister();
    expect(masterTools).toHaveLength(0);
    expect(slots.get('s1')!.getRegistry().has('a')).toBe(false);
    expect(slots.get('s1')!.getRegistry().has('b')).toBe(false);
  });

  it('registerTools unregister is idempotent', () => {
    const masterTools: Tool[] = [];
    const slots = makeSlots('s1');
    const lc = createToolLifecycle({ masterTools, masterToolSets: [], slots, sessionMgr: makeSessionMgr(['s1']), getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const unregister = lc.registerTools([makeTool('x')]);
    unregister();
    expect(() => unregister()).not.toThrow();
  });

  // ── getFilteredTools ───────────────────────────────────────────────────────

  it('getFilteredTools returns all master tools when no active session', () => {
    const masterTools: Tool[] = [makeTool('t1'), makeTool('t2')];
    const lc = createToolLifecycle({ masterTools, masterToolSets: [], slots: new Map(), sessionMgr: makeSessionMgr([]), getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const filtered = lc.getFilteredTools();
    expect(filtered.map((t) => t.name)).toEqual(['t1', 't2']);
  });

  it('getFilteredTools returns slot tools when active session has a tool manager', () => {
    const masterTools: Tool[] = [makeTool('master-only')];
    const slots = makeSlots('s1');
    const lc = createToolLifecycle({ masterTools, masterToolSets: [], slots, sessionMgr: makeSessionMgr(['s1']), getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    // Register a tool to the session's slot (this also adds to masterTools)
    lc.registerTool(makeTool('session-tool'));

    const filtered = lc.getFilteredTools();
    // When active session exists, getFilteredTools returns the SLOT's tools,
    // which includes all tools registered on that slot
    expect(filtered.map((t) => t.name)).toContain('session-tool');
  });

  it('getFilteredTools applies onFilterTools from all ToolSets', () => {
    const masterTools: Tool[] = [makeTool('visible'), makeTool('hidden')];
    const slots = makeSlots('s1');
    const lc = createToolLifecycle({
      masterTools, masterToolSets: [], slots,
      sessionMgr: makeSessionMgr(['s1']),
      getAllToolSets: () => [{
        name: 'filter',
        onFilterTools: (_ctx: any, tools: readonly Tool[]) => tools.filter((t) => t.name !== 'hidden'),
      } as any],
      agentId: AGENT_ID, getAgentClient,
    });
    // Register tools so they appear in the slot
    lc.registerTool(makeTool('visible'));
    lc.registerTool(makeTool('hidden'));

    const filtered = lc.getFilteredTools();
    // onFilterTools should filter out 'hidden'
    expect(filtered.map((t) => t.name)).not.toContain('hidden');
    expect(filtered.map((t) => t.name)).toContain('visible');
  });

  // ── registerToolSet ────────────────────────────────────────────────────────

  it('registerToolSet adds its tools to masterTools and all slots', () => {
    const masterTools: Tool[] = [];
    const masterToolSets: ToolSet[] = [];
    const slots = makeSlots('s1');
    const lc = createToolLifecycle({ masterTools, masterToolSets, slots, sessionMgr: makeSessionMgr(['s1']), getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const ts: ToolSet = { name: 'my-ts', tools: [makeTool('ts-tool')] };
    lc.registerToolSet(ts);

    expect(masterTools.map((t) => t.name)).toContain('ts-tool');
    expect(masterToolSets).toContain(ts);
    expect(slots.get('s1')!.getRegistry().has('ts-tool')).toBe(true);
  });

  it('registerToolSet calls onInit for each existing session', () => {
    const masterTools: Tool[] = [];
    const masterToolSets: ToolSet[] = [];
    const slots = makeSlots('s1', 's2');
    const lc = createToolLifecycle({ masterTools, masterToolSets, slots, sessionMgr: makeSessionMgr(['s1', 's2']), getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const onInit = vi.fn();
    const ts: ToolSet = { name: 'ts', tools: [], onInit };
    lc.registerToolSet(ts);

    expect(onInit).toHaveBeenCalledTimes(2);
    expect(onInit).toHaveBeenCalledWith(makeTsCtx('s1'), expect.any(Object));
    expect(onInit).toHaveBeenCalledWith(makeTsCtx('s2'), expect.any(Object));
  });

  it('registerToolSet returns an unregister callback that cleans up', () => {
    const masterTools: Tool[] = [];
    const masterToolSets: ToolSet[] = [];
    const slots = makeSlots('s1');
    const mgr = makeSessionMgr(['s1']);
    const lc = createToolLifecycle({ masterTools, masterToolSets, slots, sessionMgr: mgr, getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const onRemove = vi.fn();
    const ts: ToolSet = { name: 'ts', tools: [makeTool('ts-t')], onRemove };
    const unregister = lc.registerToolSet(ts);
    unregister();

    expect(masterToolSets).not.toContain(ts);
    expect(masterTools.map((t) => t.name)).not.toContain('ts-t');
    expect(slots.get('s1')!.getRegistry().has('ts-t')).toBe(false);
    expect(onRemove).toHaveBeenCalledWith(makeTsCtx('s1'));
  });

  it('registerToolSet calls onSubscribe and externalRefresh when slot has externalRefresh', () => {
    const masterTools: Tool[] = [];
    const masterToolSets: ToolSet[] = [];
    const slots = makeSlots('s1');
    const mgr = makeSessionMgr(['s1']);

    // Set externalRefresh on the tool manager before registerToolSet is called
    const externalRefresh = vi.fn();
    slots.get('s1')!.externalRefresh = externalRefresh;

    const lc = createToolLifecycle({ masterTools, masterToolSets, slots, sessionMgr: mgr, getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const onSubscribe = vi.fn();
    const ts: ToolSet = { name: 'ts-sub', tools: [], onSubscribe };
    lc.registerToolSet(ts);

    expect(onSubscribe).toHaveBeenCalledWith(makeTsCtx('s1'), externalRefresh);
    expect(externalRefresh).toHaveBeenCalled();
  });

  it('registerToolSet calls onInit with slot.entryData for each existing session', () => {
    // Covers the path where slot.entryData is forwarded instead of a sessionMgr lookup.
    const masterTools: Tool[] = [];
    const masterToolSets: ToolSet[] = [];
    // makeSlots stores { id: 's1', title: 'Session s1' } as entryData on the slot
    const slots = makeSlots('s1');
    const mgr = makeSessionMgr(['s1']);

    const lc = createToolLifecycle({ masterTools, masterToolSets, slots, sessionMgr: mgr, getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const onInit = vi.fn();
    const ts: ToolSet = { name: 'ts-fallback', tools: [], onInit };
    lc.registerToolSet(ts);

    // onInit should be called with the slot's own entryData
    expect(onInit).toHaveBeenCalledWith(makeTsCtx('s1'), { id: 's1', title: 'Session s1' });
  });

  it('calling unregister a second time is harmless (ts not in masterToolSets)', () => {
    // Covers the `if (idx !== -1)` false branch at line 72
    const masterTools: Tool[] = [];
    const masterToolSets: ToolSet[] = [];
    const slots = makeSlots('s1');
    const mgr = makeSessionMgr(['s1']);
    const lc = createToolLifecycle({ masterTools, masterToolSets, slots, sessionMgr: mgr, getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const ts: ToolSet = { name: 'ts-double', tools: [makeTool('dt')] };
    const unregister = lc.registerToolSet(ts);
    unregister(); // first call removes ts from masterToolSets
    expect(() => unregister()).not.toThrow(); // second call: idx === -1, should not throw
  });

  it('unregister skips masterTools removal when tool is already absent (masterIdx -1 branch)', () => {
    // Covers the `if (masterIdx !== -1)` false branch at line 75
    const masterTools: Tool[] = [];
    const masterToolSets: ToolSet[] = [];
    const slots = makeSlots('s1');
    const mgr = makeSessionMgr(['s1']);
    const lc = createToolLifecycle({ masterTools, masterToolSets, slots, sessionMgr: mgr, getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient });

    const ts: ToolSet = { name: 'ts-absent', tools: [makeTool('absent-tool')] };
    const unregister = lc.registerToolSet(ts);

    // Manually remove the tool from masterTools before calling unregister
    const toolIdx = masterTools.findIndex((t) => t.name === 'absent-tool');
    masterTools.splice(toolIdx, 1);

    // Should not throw even though the tool is no longer in masterTools
    expect(() => unregister()).not.toThrow();
  });

  // ── Comprehensive unregister verification ────────────────────────────────

  describe('registerToolSet unregister: full cleanup verification', () => {
    it('unregisters ALL tools from the toolset across every session slot', () => {
      const masterTools: Tool[] = [];
      const masterToolSets: ToolSet[] = [];
      const slots = makeSlots('s1', 's2', 's3');
      const lc = createToolLifecycle({
        masterTools, masterToolSets, slots,
        sessionMgr: makeSessionMgr(['s1', 's2', 's3']),
        getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient,
      });

      const ts: ToolSet = {
        name: 'multi-tool-ts',
        tools: [makeTool('mt-a'), makeTool('mt-b'), makeTool('mt-c')],
      };
      const unregister = lc.registerToolSet(ts);

      // All tools present in all slots before unregister
      for (const id of ['s1', 's2', 's3']) {
        const reg = slots.get(id)!.getRegistry();
        expect(reg.has('mt-a')).toBe(true);
        expect(reg.has('mt-b')).toBe(true);
        expect(reg.has('mt-c')).toBe(true);
      }

      unregister();

      // ALL tools removed from ALL slots after unregister
      for (const id of ['s1', 's2', 's3']) {
        const reg = slots.get(id)!.getRegistry();
        expect(reg.has('mt-a')).toBe(false);
        expect(reg.has('mt-b')).toBe(false);
        expect(reg.has('mt-c')).toBe(false);
      }
    });

    it('triggers externalRefresh (state change notification) after unregister', () => {
      const masterTools: Tool[] = [];
      const masterToolSets: ToolSet[] = [];
      const slots = makeSlots('s1');
      const lc = createToolLifecycle({
        masterTools, masterToolSets, slots,
        sessionMgr: makeSessionMgr(['s1']),
        getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient,
      });

      const externalRefresh = vi.fn();
      slots.get('s1')!.externalRefresh = externalRefresh;

      const ts: ToolSet = { name: 'notify-ts', tools: [makeTool('nt')] };
      const unregister = lc.registerToolSet(ts);

      externalRefresh.mockClear(); // clear registration-time calls
      unregister();

      // externalRefresh MUST be called after unregister so UI state updates
      expect(externalRefresh).toHaveBeenCalled();
    });

    it('tools are not callable after unregister (registry lookup fails)', () => {
      const masterTools: Tool[] = [];
      const masterToolSets: ToolSet[] = [];
      const slots = makeSlots('s1');
      const lc = createToolLifecycle({
        masterTools, masterToolSets, slots,
        sessionMgr: makeSessionMgr(['s1']),
        getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient,
      });

      const ts: ToolSet = { name: 'callable-ts', tools: [makeTool('ct')] };
      const unregister = lc.registerToolSet(ts);

      // Tool is in the registry before unregister
      expect(slots.get('s1')!.getRegistry().has('ct')).toBe(true);

      unregister();

      // Tool is gone from the registry — pipeline's validateToolCall would
      // throw toolNotFoundError because getRegisteredTool returns undefined
      expect(slots.get('s1')!.getRegistry().has('ct')).toBe(false);
      expect(slots.get('s1')!.getRegistry().get('ct')).toBeUndefined();
    });

    it('fires onRemove for every existing session on unregister', () => {
      const masterTools: Tool[] = [];
      const masterToolSets: ToolSet[] = [];
      const slots = makeSlots('s1', 's2');
      const lc = createToolLifecycle({
        masterTools, masterToolSets, slots,
        sessionMgr: makeSessionMgr(['s1', 's2']),
        getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient,
      });

      const onRemove = vi.fn();
      const ts: ToolSet = { name: 'remove-ts', tools: [], onRemove };
      const unregister = lc.registerToolSet(ts);

      onRemove.mockClear();
      unregister();

      expect(onRemove).toHaveBeenCalledTimes(2);
      expect(onRemove).toHaveBeenCalledWith(makeTsCtx('s1'));
      expect(onRemove).toHaveBeenCalledWith(makeTsCtx('s2'));
    });

    it('tears down onSubscribe subscriptions on unregister', () => {
      const masterTools: Tool[] = [];
      const masterToolSets: ToolSet[] = [];
      const slots = makeSlots('s1');
      const lc = createToolLifecycle({
        masterTools, masterToolSets, slots,
        sessionMgr: makeSessionMgr(['s1']),
        getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient,
      });

      const unsubFn = vi.fn();
      const externalRefresh = vi.fn();
      slots.get('s1')!.externalRefresh = externalRefresh;

      const ts: ToolSet = {
        name: 'sub-ts',
        tools: [],
        onSubscribe: () => unsubFn,
      };
      const unregister = lc.registerToolSet(ts);

      expect(unsubFn).not.toHaveBeenCalled();

      unregister();

      // The onSubscribe-returned unsubscribe function must be called
      expect(unsubFn).toHaveBeenCalledTimes(1);
    });

    it('calls onAttach detach callback on unregister', () => {
      const masterTools: Tool[] = [];
      const masterToolSets: ToolSet[] = [];
      const slots = makeSlots('s1');
      const lc = createToolLifecycle({
        masterTools, masterToolSets, slots,
        sessionMgr: makeSessionMgr(['s1']),
        getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient,
      });

      const detachFn = vi.fn();
      const ts: ToolSet = {
        name: 'detach-ts',
        tools: [],
        onAttach: () => detachFn,
      };
      const unregister = lc.registerToolSet(ts);

      expect(detachFn).not.toHaveBeenCalled();

      unregister();

      expect(detachFn).toHaveBeenCalledTimes(1);
    });

    it('unregistering one toolset does NOT remove same-named tool from another toolset', () => {
      // Regression: cleanup used findIndex by name which could remove the
      // wrong tool when two ToolSets register tools with the same name.
      const masterTools: Tool[] = [];
      const masterToolSets: ToolSet[] = [];
      const slots = makeSlots('s1');
      const lc = createToolLifecycle({
        masterTools, masterToolSets, slots,
        sessionMgr: makeSessionMgr(['s1']),
        getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient,
      });

      const toolA = makeTool('conflict');
      const toolB = makeTool('conflict');
      const tsA: ToolSet = { name: 'ts-A', tools: [toolA] };
      const tsB: ToolSet = { name: 'ts-B', tools: [toolB] };

      lc.registerToolSet(tsA);
      const unregisterB = lc.registerToolSet(tsB);

      // Before unregister: both tools are in masterTools (different refs)
      expect(masterTools.filter((t) => t.name === 'conflict')).toHaveLength(2);

      unregisterB();

      // After unregister B: toolB is gone, but toolA remains in masterTools
      const remaining = masterTools.filter((t) => t.name === 'conflict');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toBe(toolA);
    });

    it('unregistering one toolset preserves same-named tool from another toolset in masterTools', () => {
      // Regression: unregisterByName removes the Map entry by name — if two
      // ToolSets share a tool name, unregistering the FIRST one must NOT
      // remove the second one's tool reference from masterTools.
      const masterTools: Tool[] = [];
      const masterToolSets: ToolSet[] = [];
      const slots = makeSlots('s1');
      const lc = createToolLifecycle({
        masterTools, masterToolSets, slots,
        sessionMgr: makeSessionMgr(['s1']),
        getAllToolSets: () => [], agentId: AGENT_ID, getAgentClient,
      });

      const toolA = makeTool('conflict');
      const toolB = makeTool('conflict');
      const tsA: ToolSet = { name: 'ts-A', tools: [toolA] };
      const tsB: ToolSet = { name: 'ts-B', tools: [toolB] };

      const unregisterA = lc.registerToolSet(tsA);
      lc.registerToolSet(tsB); // tsB's version overwrites in registry

      // Both tool references exist in masterTools before unregister
      expect(masterTools.filter((t) => t.name === 'conflict')).toHaveLength(2);

      unregisterA();

      // Only tsA's toolA is removed from masterTools — toolB stays
      const remaining = masterTools.filter((t) => t.name === 'conflict');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toBe(toolB);
    });
  });
});
