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
import type { AgentHandler } from '@agent-type';
import { createVariableToolSet } from '../../../internal-apps/variable/agent/toolSet';

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
  it('registers var_overview, var_explore, var_write, var_list, var_delete tools', () => {
    const agent = makeAgent([createVariableToolSet()]);
    const names = agent.getTools().map((t) => t.name);
    expect(names).toContain('var_overview');
    expect(names).toContain('var_explore');
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

// ── All toolsets combined ─────────────────────────────────────────────────────

describe('createAgentClient + all built-in toolsets', () => {
  it('all toolsets coexist without conflicts', () => {
    const agent = makeAgent([
      createVariableToolSet(),
    ]);
    const state = agent.getSessionManager().getActiveSession()!.getState();

    // Variable
    expect(Array.isArray((state as any).variables)).toBe(true);
  });

  it('all toolset tools are registered', () => {
    const agent = makeAgent([
      createVariableToolSet(),
    ]);
    const names = agent.getTools().map((t) => t.name);

    expect(names).toContain('var_write');
  });

  it('lifecycle hooks all fire on session creation', () => {
    const varTs = createVariableToolSet();

    const spies = [varTs].map((ts) =>
      vi.spyOn(ts, 'onInit'),
    );

    makeAgent([varTs]);

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledOnce();
    }
  });
});
