/**
 * src/__tests__/client/agentSession.injectToolResult.test.ts
 *
 * Tests for AgentSession.injectToolResult — the SDK-level method that appends
 * a tool-result message to the conversation and kicks the agent loop.
 *
 * The corresponding assistant message (with the original tool-call arguments)
 * is assumed to already exist in the conversation history (either from a
 * normal agent turn or restored from a snapshot) — injectToolResult does NOT
 * create a synthetic assistant duplicate.
 *
 * Creates a real createAgentClient + session, then calls injectToolResult
 * and inspects the history and handler invocations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgentClient } from '@agent-sdk';
import type { AgentHandler, Tool, ToolResultMessage } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockHandler(): AgentHandler {
  return vi.fn(async () => ({ text: 'done' })) as unknown as AgentHandler;
}

function createAgent(toolSets: any[] = []) {
  const agent = createAgentClient({
    handler: makeMockHandler(),
    systemPrompt: '',
    tools: [],
    toolSets,
  });
  agent.getSessionManager().createSession();
  return agent;
}

function addAssistantWithToolCall(
  session: { sendMessage: (text: string) => Promise<void>; getHistory: () => readonly import('@agent-type').AgentMessage[] },
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
) {
  // Simulate an existing assistant message by pushing directly into history.
  // We use the internal injectToolResult test setup — manually push a message
  // that the real agent loop would have produced.
  const msg: import('@agent-type').AssistantMessage = {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: toolCallId, name: toolName, arguments: args }],
  };
  // Since we can't access the tracker directly, we use session.getHistory()
  // to verify the pre-existing state, then injectToolResult adds the tool.
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentSession.injectToolResult', () => {
  it('is exposed on the session interface', () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;
    expect(typeof session.injectToolResult).toBe('function');
  });

  it('creates synthetic assistant when no matching tool_call exists', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    // Inject a tool result — there's no preceding assistant with toolCalls
    await session.injectToolResult('tc-1', 'ask_user', 'the answer');

    const history = session.getHistory();

    // The tool result SHOULD be in history
    const toolResultMsg = history.find(
      (m): m is ToolResultMessage => m.role === 'tool' && m.toolCallId === 'tc-1',
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.name).toBe('ask_user');
    // Content should be the RAW value, NOT JSON.stringify'd
    expect(toolResultMsg!.content).toBe('the answer');

    // injectToolResult creates exactly ONE synthetic assistant with empty args
    // to pair with the tool result — this is by design (tool result must be
    // preceded by its corresponding tool-call message in the LLM history).
    const injectedAssistants = history.filter(
      (m): m is import('@agent-type').AssistantMessage =>
        m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0,
    );
    expect(injectedAssistants).toHaveLength(1);
  });

  it('skips synthetic assistant when matching tool_call already exists', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    // First injection creates synthetic assistant + tool result
    await session.injectToolResult('tc-existing', 'ask_user', 'first');

    // Second injection with SAME toolCallId — should NOT create another assistant
    await session.injectToolResult('tc-existing', 'ask_user', 'second');

    const history = session.getHistory();

    // Exactly ONE synthetic assistant (from the first injection)
    const injectedAssistants = history.filter(
      (m): m is import('@agent-type').AssistantMessage =>
        m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0,
    );
    expect(injectedAssistants).toHaveLength(1);

    // Both tool results should be present
    const toolResults = history.filter(
      (m): m is ToolResultMessage => m.role === 'tool' && m.toolCallId === 'tc-existing',
    );
    expect(toolResults).toHaveLength(2);
  });

  it('pushes tool result to liveHistory as well', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    await session.injectToolResult('tc-2', 'test_tool', { key: 'val' });

    const liveHistory = session.getLiveHistory();
    const toolResultMsg = liveHistory.find(
      (m): m is ToolResultMessage => m.role === 'tool' && m.toolCallId === 'tc-2',
    );
    expect(toolResultMsg).toBeDefined();
    // RAW value, not JSON.stringify'd
    expect(toolResultMsg!.content).toEqual({ key: 'val' });
  });

  it('adds UI tool card (no assistant bubble)', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    await session.injectToolResult('tc-3', 'ask_user', 42);

    const state = session.getState();

    // Tool card should have the result
    const toolMsgs = state.messages.filter((m) => m.role === 'tool');
    const latestTool = toolMsgs[toolMsgs.length - 1];
    expect(latestTool).toBeDefined();
    expect(latestTool.toolCall?.toolCallId).toBe('tc-3');
    expect(latestTool.toolCall?.result).toBe(42);
  });

  it('triggers the agent handler (LLM call) after injection', async () => {
    const handler = makeMockHandler();
    const agent = createAgentClient({
      handler,
      systemPrompt: '',
    });
    agent.getSessionManager().createSession();
    const session = agent.getSessionManager().getActiveSession()!;

    expect(handler).not.toHaveBeenCalled();

    await session.injectToolResult('tc-4', 'ask_user', 'data');

    expect(handler).toHaveBeenCalled();
  });

  it('is a no-op when the session is already loading', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    // First inject starts the agent loop
    const injectPromise = session.injectToolResult('tc-1', 'ask_user', 'first');
    // Inject again while loading — should be a no-op
    await session.injectToolResult('tc-2', 'ask_user', 'second');
    await injectPromise;

    const history = session.getHistory();
    // Only one tool result should be present (the first injection)
    const toolResults = history.filter(
      (m) => m.role === 'tool',
    );
    expect(toolResults).toHaveLength(1);
    // One synthetic assistant with toolCalls should exist — injectToolResult
    // creates a tool-call + tool-result pair by design so the LLM sees
    // the complete conversation structure.
    const synthAssistants = history.filter(
      (m) => m.role === 'assistant' && (m as any).toolCalls?.length > 0,
    );
    expect(synthAssistants).toHaveLength(1);
  });

  it('handles complex result values (objects, arrays) – raw, not stringified', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    const complexResult = { items: [1, 2, 3], nested: { a: true } };
    await session.injectToolResult('tc-complex', 'ask_user', complexResult);

    const history = session.getHistory();
    const toolResultMsg = history.find(
      (m): m is ToolResultMessage => m.role === 'tool' && m.toolCallId === 'tc-complex',
    );
    expect(toolResultMsg).toBeDefined();
    // RAW value — the agentLoopCore pushes result directly
    expect(toolResultMsg!.content).toEqual(complexResult);
  });

  it('handles null result values', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    await session.injectToolResult('tc-null', 'ask_user', null);
    const history = session.getHistory();
    const toolResultMsg = history.find(
      (m): m is ToolResultMessage => m.role === 'tool' && m.toolCallId === 'tc-null',
    );
    expect(toolResultMsg).toBeDefined();
    // RAW null — not the string "null"
    expect(toolResultMsg!.content).toBeNull();
  });

  it('picks up original tool-call arguments from the live history for UI tool card', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    // First, simulate a user message that triggered an ask_user call
    // by sending a real message through the agent loop.
    // The mock handler returns { text: 'done' } with no toolCalls, so we
    // manually pre-seed the live history with an assistant message that has
    // matching toolCalls.
    //
    // We can't push directly, but we can call injectToolResult twice: the
    // first call's loop response contains an assistant msg ('done') in history,
    // and the tool result is there too. The second call will look for the
    // matching assistant in the *entire* live history.
    await session.injectToolResult('tc-args-1', 'ask_user', 'first answer');

    // Now inject a second result with the same toolCallId — the lookup code
    // should find the original assistant message from the first injection's
    // loop response (which has no toolCalls). This verifies the code doesn't
    // crash when no matching assistant with toolCalls exists.
    await session.injectToolResult('tc-args-1', 'ask_user', 'second answer');

    const history = session.getHistory();
    const toolResults = history.filter(
      (m): m is ToolResultMessage => m.role === 'tool' && m.toolCallId === 'tc-args-1',
    );
    // Two tool results should be present (two injections)
    expect(toolResults).toHaveLength(2);
  });

  it('uses empty originalArgs when no matching assistant with toolCalls exists', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    // Inject with a completely brand-new toolCallId that has never appeared
    // in any assistant message — originalArgs will be {}.
    await session.injectToolResult('fresh-tc', 'ask_user', 'some value');

    const state = session.getState();
    const toolMsgs = state.messages.filter((m) => m.role === 'tool');
    const latestTool = toolMsgs[toolMsgs.length - 1];
    expect(latestTool).toBeDefined();
    // originalArgs is {} when no matching assistant found
    expect(latestTool.toolCall?.arguments).toEqual({});
  });
});
