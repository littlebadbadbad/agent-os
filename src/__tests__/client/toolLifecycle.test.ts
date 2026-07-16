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

/** Minimal AgentClientLike stub �?enough for onAttach calls in tests. */
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
      sessions: sessionIds.map((id) => ({ id, title: `Session ${id}`, session: {} as never })),
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
});
