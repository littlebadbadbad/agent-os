/**
 * Integration tests verifying that each built-in ToolSet works correctly when
 * installed into a real `createAgentClient` instance.
 *
 * Test strategy
 * ─────────────
 * �?Every test creates a fresh `createAgentClient` (+ auto-created "New Chat"
 *   session) and inspects the session state / registered tools directly.
 * �?Handler is mocked to return `{ text: 'done' }` so turn-based assertions
 *   stay fast and deterministic.
 * �?ToolSet hooks are spied on with `vi.spyOn` to verify they fire at the
 *   right lifecycle points.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentClient, createTodoTools, createToolStateToolSet, createExperienceTools, createTokenBudgetToolSet, createVariableToolSet, createMemoryGraphToolSet, MAIN_CONVERSATION_ID } from '@agent-sdk';
import type { AgentHandler } from '@agent-sdk';

// ── Mock handler ──────────────────────────────────────────────────────────────

function makeMockHandler(): AgentHandler {
  return vi.fn(async () => ({ text: 'done' })) as unknown as AgentHandler;
}

// ── Agent factory helper ──────────────────────────────────────────────────────

function makeAgent(toolSets: ReturnType<typeof createTodoTools>[] | any[]) {
  return createAgentClient({
    handler: makeMockHandler(),
    systemPrompt: '',
    tools: [],
    toolSets,
  });
}

// ── TodoToolSet ───────────────────────────────────────────────────────────────

describe('createAgentClient + TodoToolSet', () => {
  it('registers todo_write and todo_read tools', () => {
    const agent = makeAgent([createTodoTools()]);
    const names = agent.getTools().map((t) => t.name);
    expect(names).toContain('todo_write');
    expect(names).toContain('todo_read');
  });

  it('session state has todos: [] on creation', () => {
    const agent = makeAgent([createTodoTools()]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    expect(Array.isArray(state.todos)).toBe(true);
    expect(state.todos).toHaveLength(0);
  });

  it('onInitSession fires for the auto-created session', () => {
    const ts = createTodoTools();
    const spy = vi.spyOn(ts, 'onInitSession');
    makeAgent([ts]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('onRemoveSession fires when a session is removed', () => {
    const ts = createTodoTools();
    const spy = vi.spyOn(ts, 'onRemoveSession');
    const agent = makeAgent([ts]);
    const { sessions } = agent.getSessionManager().getState();
    agent.getSessionManager().removeSession(sessions[0].id);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('onResetSession fires when session history is cleared', () => {
    const ts = createTodoTools();
    const spy = vi.spyOn(ts, 'onResetSession');
    const agent = makeAgent([ts]);
    agent.getSessionManager().getActiveSession()!.clearHistory();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('new sessions also have todos: [] and fire onInitSession', () => {
    const ts = createTodoTools();
    const spy = vi.spyOn(ts, 'onInitSession');
    const agent = makeAgent([ts]);
    agent.getSessionManager().createSession();
    // Called once for the auto session, once for the new session
    expect(spy).toHaveBeenCalledTimes(2);
    const sessions = agent.getSessionManager().getState().sessions;
    const newSession = sessions[sessions.length - 1].session;
    expect(newSession.getState().todos).toHaveLength(0);
  });

  it('todo state updates fire subscribers', async () => {
    const ts = createTodoTools();
    const agent = makeAgent([ts]);
    const session = agent.getSessionManager().getActiveSession()!;
    const fn = vi.fn();
    session.subscribe(fn);

    // Execute the todo_write tool directly to trigger a state change.
    const ctx = {
      sessionId: agent.getSessionManager().getState().sessions[0].id,
      agentName: 'main',
      conversationId: MAIN_CONVERSATION_ID,
      signal: new AbortController().signal,

        requestUserInput: () => Promise.resolve(null),

        cancelUserInput: () => {},

      };
    const writeTool = agent.getTools().find((t) => t.name === 'todo_write')!;
    await writeTool.execute(
      { todos: [{ id: 1, title: 'Buy milk', status: 'not-started', priority: 'medium' }] },
      ctx,
    );

    expect(fn).toHaveBeenCalled();
    expect(session.getState().todos).toHaveLength(1);
  });
});

// ── ToolStateToolSet ──────────────────────────────────────────────────────────

describe('createAgentClient + ToolStateToolSet', () => {
  it('ToolStateToolSet contributes no tools of its own', () => {
    const ts = createToolStateToolSet();
    const agent = makeAgent([ts]);
    // The toolset registers no tools, so getTools() is empty (no other tools configured)
    expect(agent.getTools()).toHaveLength(0);
  });

  it('session state has toolStates array on creation', () => {
    const ts = createToolStateToolSet();
    const agent = makeAgent([ts]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    expect(Array.isArray(state.toolStates)).toBe(true);
  });

  it('toolStates reflects all registered tools', () => {
    const ts = createToolStateToolSet();
    const todoTs = createTodoTools();
    const agent = makeAgent([ts, todoTs]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    const names = state.toolStates.map((t) => t.name);
    expect(names).toContain('todo_write');
    expect(names).toContain('todo_read');
  });

  it('all tools start as enabled', () => {
    const ts = createToolStateToolSet();
    const todoTs = createTodoTools();
    const agent = makeAgent([ts, todoTs]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    expect(state.toolStates.every((t) => t.enabled)).toBe(true);
  });

  it('onInitSession fires for the auto-created session', () => {
    const ts = createToolStateToolSet();
    const spy = vi.spyOn(ts, 'onInitSession');
    makeAgent([ts]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('onRemoveSession fires and cleans up', () => {
    const ts = createToolStateToolSet();
    const spy = vi.spyOn(ts, 'onRemoveSession');
    const agent = makeAgent([ts]);
    const { sessions } = agent.getSessionManager().getState();
    agent.getSessionManager().removeSession(sessions[0].id);
    expect(spy).toHaveBeenCalledOnce();
  });
});

// ── ExperienceToolSet ─────────────────────────────────────────────────────────

describe('createAgentClient + ExperienceToolSet', () => {
  it('registers experience_add, experience_update, experience_delete, experience_list', () => {
    const agent = makeAgent([createExperienceTools()]);
    const names = agent.getTools().map((t) => t.name);
    expect(names).toContain('experience_add');
    expect(names).toContain('experience_update');
    expect(names).toContain('experience_delete');
    expect(names).toContain('experience_list');
  });

  it('session state has experiences: [] on creation', () => {
    const agent = makeAgent([createExperienceTools()]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    expect(Array.isArray((state as any).experiences)).toBe(true);
    expect((state as any).experiences).toHaveLength(0);
  });

  it('session state has experienceStore reference', () => {
    const agent = makeAgent([createExperienceTools()]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    expect(typeof (state as any).experienceStore?.add).toBe('function');
  });

  it('onInitSession fires for the auto-created session', () => {
    const ts = createExperienceTools();
    const spy = vi.spyOn(ts, 'onInitSession');
    makeAgent([ts]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('experiences persist across multiple sessions (global pool)', async () => {
    const ts = createExperienceTools();
    const agent = makeAgent([ts]);
    // Add experience via tool
    const addTool = agent.getTools().find((t) => t.name === 'experience_add')!;
    const sessionId = agent.getSessionManager().getState().sessions[0].id;
    const ctx = {
      sessionId,
      agentName: 'main',
      conversationId: sessionId,
      signal: new AbortController().signal,

        requestUserInput: () => Promise.resolve(null),

        cancelUserInput: () => {},

      };
    await addTool.execute({ trigger: 'T', insight: 'I' }, ctx);

    // Create a second session �?it should also see the experience
    agent.getSessionManager().createSession();
    const sessions = agent.getSessionManager().getState().sessions;
    const session2State = sessions[sessions.length - 1].session.getState();
    expect((session2State as any).experiences).toHaveLength(1);
  });
});

// ── TokenBudgetToolSet ────────────────────────────────────────────────────────

describe('createAgentClient + TokenBudgetToolSet', () => {
  it('TokenBudgetToolSet contributes no tools', () => {
    const ts = createTokenBudgetToolSet(() => ({ maxTokens: 4096 }));
    const agent = makeAgent([ts]);
    expect(agent.getTools()).toHaveLength(0);
  });

  it('session state has tokenBudget defined on creation', () => {
    const ts = createTokenBudgetToolSet(() => ({ maxTokens: 4096 }));
    const agent = makeAgent([ts]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    expect(state.tokenBudget).toBeDefined();
    expect(state.tokenBudget?.maxTokens).toBe(4096);
  });

  it('session state has tokenBudget: undefined when getConfig returns undefined', () => {
    const ts = createTokenBudgetToolSet(() => undefined);
    const agent = makeAgent([ts]);
    const state = agent.getSessionManager().getActiveSession()!.getState();
    expect(state.tokenBudget).toBeUndefined();
  });

  it('onInitSession fires for the auto-created session', () => {
    const ts = createTokenBudgetToolSet(() => ({ maxTokens: 4096 }));
    const spy = vi.spyOn(ts, 'onInitSession');
    makeAgent([ts]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('onRemoveSession fires and removes tracker', () => {
    const ts = createTokenBudgetToolSet(() => ({ maxTokens: 4096 }));
    const spy = vi.spyOn(ts, 'onRemoveSession');
    const agent = makeAgent([ts]);
    const { sessions } = agent.getSessionManager().getState();
    agent.getSessionManager().removeSession(sessions[0].id);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('new sessions also get a tracker', () => {
    const ts = createTokenBudgetToolSet(() => ({ maxTokens: 8000 }));
    const agent = makeAgent([ts]);
    agent.getSessionManager().createSession();
    const sessions = agent.getSessionManager().getState().sessions;
    const newSessionState = sessions[sessions.length - 1].session.getState();
    expect(newSessionState.tokenBudget?.maxTokens).toBe(8000);
  });
});

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

  it('onInitSession fires for the auto-created session', () => {
    const ts = createVariableToolSet();
    const spy = vi.spyOn(ts, 'onInitSession');
    makeAgent([ts]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('onRemoveSession fires and cleans up the store', () => {
    const ts = createVariableToolSet();
    const spy = vi.spyOn(ts, 'onRemoveSession');
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
      conversationId: sessionId1,
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

  it('onInitSession fires for the auto-created session', () => {
    const ts = createMemoryGraphToolSet();
    const spy = vi.spyOn(ts, 'onInitSession');
    makeAgent([ts]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('onRemoveSession fires when a session is removed', () => {
    const ts = createMemoryGraphToolSet();
    const spy = vi.spyOn(ts, 'onRemoveSession');
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
      createTodoTools(),
      createToolStateToolSet(),
      createExperienceTools(),
      createTokenBudgetToolSet(() => ({ maxTokens: 4096 })),
      createVariableToolSet(),
      createMemoryGraphToolSet(),
    ]);
    const state = agent.getSessionManager().getActiveSession()!.getState();

    // Todo
    expect(Array.isArray(state.todos)).toBe(true);
    // ToolState
    expect(Array.isArray(state.toolStates)).toBe(true);
    // Experience
    expect(Array.isArray((state as any).experiences)).toBe(true);
    // TokenBudget
    expect(state.tokenBudget).toBeDefined();
    // Variable
    expect(Array.isArray((state as any).variables)).toBe(true);
    // MemoryGraph
    expect('memoryGraph' in state).toBe(true);
  });

  it('all toolset tools are registered', () => {
    const agent = makeAgent([
      createTodoTools(),
      createToolStateToolSet(),
      createExperienceTools(),
      createTokenBudgetToolSet(() => ({ maxTokens: 4096 })),
      createVariableToolSet(),
      createMemoryGraphToolSet(),
    ]);
    const names = agent.getTools().map((t) => t.name);

    expect(names).toContain('todo_write');
    expect(names).toContain('experience_add');
    expect(names).toContain('var_write');
    expect(names).toContain('memory_recall');
  });

  it('lifecycle hooks all fire on session creation', () => {
    const todoTs = createTodoTools();
    const tsTs = createToolStateToolSet();
    const expTs = createExperienceTools();
    const tbTs = createTokenBudgetToolSet(() => ({ maxTokens: 4096 }));
    const varTs = createVariableToolSet();
    const mgTs = createMemoryGraphToolSet();

    const spies = [todoTs, tsTs, expTs, tbTs, varTs, mgTs].map((ts) =>
      vi.spyOn(ts, 'onInitSession'),
    );

    makeAgent([todoTs, tsTs, expTs, tbTs, varTs, mgTs]);

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledOnce();
    }
  });
});
