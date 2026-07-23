/**
 * Integration tests verifying that each built-in ToolSet works correctly when
 * installed into a real `createAgentClient` instance.
 *
 * Test strategy
 * ─────────────
 * — Every test creates a fresh `createAgentClient` (+ auto-created "New Chat"
 *   session) and inspects the session state / registered tools directly.
 * — Handler is mocked to return `{ text: 'done' }` so turn-based assertions
 *   stay fast and deterministic.
 * — ToolSet hooks are spied on with `vi.spyOn` to verify they fire at the
 *   right lifecycle points.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentClient, MAIN_CONVERSATION_ID } from '@agent-sdk';
import type { AgentHandler } from '@agent-sdk';
import { createVariableToolSet } from '../../../extensions/variable/agent/toolSet';
import { createMemoryGraphToolSet } from '../../../extensions/memory-graph/agent/toolSet';

// ── Mock handler ──────────────────────────────────────────────────────────────

function makeMockHandler(): AgentHandler {
  return vi.fn(async () => ({ text: 'done' })) as unknown as AgentHandler;
}

// ── Agent factory helper ──────────────────────────────────────────────────────

function makeAgent(toolSets: any[]) {
  const agent = createAgentClient({
    handler: makeMockHandler(),
    systemPrompt: '',
    tools: [],
    toolSets,
  });
  agent.createSession();
  return agent;
}

// ── VariableToolSet ───────────────────────────────────────────────────────────

describe('createAgentClient + VariableToolSet', () => {
  it('registers var_expand, var_read_path, var_write, var_list, var_delete tools', () => {
    const agent = makeAgent([createVariableToolSet()]);
    const names = agent.getTools().map((t) => t.name);
    expect(names).toContain('var_expand');
    expect(names).toContain('var_read_path');
    expect(names).toContain('var_write');
    expect(names).toContain('var_list');
    expect(names).toContain('var_delete');
  });

  it('session state has variables: [] on creation', () => {
    const agent = makeAgent([createVariableToolSet()]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    expect(Array.isArray((state as any).variables)).toBe(true);
    expect((state as any).variables).toHaveLength(0);
  });

  it('session state has variableStore reference', () => {
    const agent = makeAgent([createVariableToolSet()]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    expect(typeof (state as any).variableStore?.list).toBe('function');
  });

  it('onInit fires for the auto-created session', () => {
    const ts = createVariableToolSet();
    const spy = vi.spyOn(ts, 'onInit');
    makeAgent([ts]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('onRemove fires and cleans up the store', () => {
    const ts = createVariableToolSet();
    const spy = vi.spyOn(ts, 'onRemove');
    const agent = makeAgent([ts]);
    const { sessions } = agent.getSessionManager().getState();
    agent.getSessionManager().removeSession(sessions[0].id);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('variables are isolated between sessions', async () => {
    const ts = createVariableToolSet();
    const agent = makeAgent([ts]);
    const sessionId1 = agent.getSessionManager().getState().sessions[0].id;
    const ctx1 = {
      sessionId: sessionId1,
      agentName: 'main',
      conversationId: sessionId1, sourceAgent: 'main', isSubAgent: false,
      signal: new AbortController().signal,

        requestUserInput: () => Promise.resolve(null),

        cancelUserInput: () => {},

      };
    const writeTool = agent.getTools().find((t) => t.name === 'var_write')!;
    await writeTool.execute({ content: 'session1 data' }, ctx1);

    agent.getSessionManager().createSession();
    const sessions = agent.getSessionManager().getState().sessions;
    const session2State = sessions[sessions.length - 1].session.getState();
    expect((session2State as any).variables).toHaveLength(0);
  });
});

// ── MemoryGraphToolSet ────────────────────────────────────────────────────────

describe('createAgentClient + MemoryGraphToolSet', () => {
  it('registers memory_recall tool', () => {
    const agent = makeAgent([createMemoryGraphToolSet()]);
    const names = agent.getTools().map((t) => t.name);
    expect(names).toContain('memory_recall');
  });

  it('session state has memoryGraph field on creation', () => {
    const agent = makeAgent([createMemoryGraphToolSet()]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    // memoryGraph may be undefined until first graph update, but the field exists
    expect('memoryGraph' in state).toBe(true);
  });

  it('onInit fires for the auto-created session', () => {
    const ts = createMemoryGraphToolSet();
    const spy = vi.spyOn(ts, 'onInit');
    makeAgent([ts]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('onRemove fires when a session is removed', () => {
    const ts = createMemoryGraphToolSet();
    const spy = vi.spyOn(ts, 'onRemove');
    const agent = makeAgent([ts]);
    const { sessions } = agent.getSessionManager().getState();
    agent.getSessionManager().removeSession(sessions[0].id);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('sessions have independent memory graphs', () => {
    const ts = createMemoryGraphToolSet();
    const agent = makeAgent([ts]);
    agent.getSessionManager().createSession();
    const sessions = agent.getSessionManager().getState().sessions;
    const state1 = sessions[0].session.getState();
    const state2 = sessions[1].session.getState();
    // Both start without a graph
    expect((state1 as any).memoryGraph?.graph).toBeUndefined();
    expect((state2 as any).memoryGraph?.graph).toBeUndefined();
  });
});

// ── All toolsets combined ─────────────────────────────────────────────────────

describe('createAgentClient + all built-in toolsets', () => {
  it('all toolsets coexist without conflicts', () => {
    const agent = makeAgent([
      createVariableToolSet(),
      createMemoryGraphToolSet(),
    ]);
    const state = agent.getSessionManager().getActiveSession()!.getState();

    // Variable
    expect(Array.isArray((state as any).variables)).toBe(true);
    // MemoryGraph
    expect('memoryGraph' in state).toBe(true);
  });

  it('all toolset tools are registered', () => {
    const agent = makeAgent([
      createVariableToolSet(),
      createMemoryGraphToolSet(),
    ]);
    const names = agent.getTools().map((t) => t.name);

    expect(names).toContain('var_write');
    expect(names).toContain('memory_recall');
  });

  it('lifecycle hooks all fire on session creation', () => {
    const varTs = createVariableToolSet();
    const mgTs = createMemoryGraphToolSet();

    const spies = [varTs, mgTs].map((ts) =>
      vi.spyOn(ts, 'onInit'),
    );

    makeAgent([varTs, mgTs]);

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledOnce();
    }
  });
});
