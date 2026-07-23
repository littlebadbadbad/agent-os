

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoopCore } from '../../tools/agentLoopCore';
import type { AgentLoopCoreConfig } from '../../tools/agentLoopCore';
import type { AgentTurnResponse, ToolCall, ToolResult, AgentStreamChunk, AgentMessage } from '@agent-type';

// ── Mock drainAgentStream ─────────────────────────────────────────────────────

vi.mock('../../tools/agentLoop', () => ({
  drainAgentStream: vi.fn(),
}));

import { drainAgentStream, type AgentStreamHooks } from '../../tools/agentLoop';

const mockDrain = vi.mocked(drainAgentStream);

// ── Fixture factories ─────────────────────────────────────────────────────────

function turnResponse(overrides: Partial<AgentTurnResponse> = {}): AgentTurnResponse {
  return { text: 'done', ...overrides };
}

function toolCall(id: string, name = 'echo'): ToolCall {
  return { id, name, arguments: {} };
}

function toolResult(id: string, name = 'echo', result = 'ok'): ToolResult {
  return { toolCallId: id, name, result };
}

function streamResult(overrides: Partial<{
  text: string; thinking: string;
  toolCalls: ToolCall[]; toolResultPairs: { call: ToolCall; result: ToolResult }[];
  attachments: never[]; usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  shouldContinue: boolean;
}> = {}) {
  return {
    text: '', thinking: '', toolCalls: [], toolResultPairs: [], attachments: [],
    usage: undefined, shouldContinue: false, ...overrides,
  };
}

function makeStream(): ReadableStream<AgentStreamChunk> {
  return new ReadableStream({ start(c) { c.close(); } });
}

/** Minimal config: single-turn async handler, no tools, no hooks. */
function minimalConfig(
  response: AgentTurnResponse = turnResponse(),
  extra: Partial<AgentLoopCoreConfig> = {},
): AgentLoopCoreConfig {
  return {
    initialHistory: [{ role: 'user', content: 'hello' }],
    maxTurns: 10,
    signal: new AbortController().signal,
    invokeHandler: vi.fn().mockResolvedValue(response),
    callTool: vi.fn(),
    ...extra,
  };
}

// ── Non-streaming path: natural completion (no tool calls) ────────────────────

describe('runAgentLoopCore — non-streaming, natural completion', () => {
  it('returns completed=true, output, turns=1 when no tool calls', async () => {
    const config = minimalConfig(turnResponse({ text: 'hello world' }));
    const res = await runAgentLoopCore(config);
    expect(res.completed).toBe(true);
    expect(res.output).toBe('hello world');
    expect(res.turns).toBe(1);
    expect(res.toolCallCount).toBe(0);
  });

  it('onAfterTurn absent — completed=true without crashing', async () => {
    const config = minimalConfig(turnResponse({ text: 'ok' }), { hooks: {} });
    const res = await runAgentLoopCore(config);
    expect(res.completed).toBe(true);
  });

  it('onAfterTurn called with snapshot history and usage', async () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    const onAfterTurn = vi.fn().mockResolvedValue(undefined);
    const config = minimalConfig(turnResponse({ text: 'hi', usage }), {
      hooks: { onAfterTurn },
    });
    await runAgentLoopCore(config);
    expect(onAfterTurn).toHaveBeenCalledOnce();
    const [histArg, usageArg] = onAfterTurn.mock.calls[0];
    expect(usageArg).toEqual(usage);
    expect(histArg.at(-1)).toMatchObject({ role: 'assistant', content: 'hi' });
  });

  it('onAfterTurn returning a new array replaces history (compaction)', async () => {
    const compacted = [{ role: 'user' as const, content: 'compacted' }];
    const onAfterTurn = vi.fn().mockResolvedValue(compacted);
    // Two turns: first returns no tools (natural completion after compaction)
    const invokeHandler = vi.fn().mockResolvedValue(turnResponse({ text: 'answer' }));
    const config: AgentLoopCoreConfig = {
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 1,
      signal: new AbortController().signal,
      invokeHandler,
      callTool: vi.fn(),
      hooks: { onAfterTurn },
    };
    const res = await runAgentLoopCore(config);
    // history in result is the compacted version + assistant message will not be re-added
    // since compaction returned [{ role:'user', content:'compacted' }], and that's set as history
    // immediately before completed=true+break, so final history = compacted
    expect(res.history).toEqual(compacted);
  });

  it('onAfterTurn returning void keeps existing history', async () => {
    const onAfterTurn = vi.fn().mockResolvedValue(undefined);
    const config = minimalConfig(turnResponse({ text: 'result' }), {
      hooks: { onAfterTurn },
    });
    const res = await runAgentLoopCore(config);
    // history = [user, assistant]
    expect(res.history).toHaveLength(2);
    expect(res.history[1]).toMatchObject({ role: 'assistant', content: 'result' });
  });

  it('onTurnBegin fires with turn=0 before invokeHandler', async () => {
    const order: string[] = [];
    const invokeHandler = vi.fn().mockImplementation(async () => {
      order.push('handler');
      return turnResponse();
    });
    const onTurnBegin = vi.fn().mockImplementation((t: number) => order.push(`turn_start(${t})`));
    await runAgentLoopCore({ ...minimalConfig(turnResponse(), { invokeHandler }), hooks: { onTurnBegin } });
    expect(order[0]).toBe('turn_start(0)');
    expect(order[1]).toBe('handler');
  });

  it('onAssistantText called with text and thinking', async () => {
    const onAssistantText = vi.fn();
    const config = minimalConfig(turnResponse({ text: 'reply', thinking: 'thought' }), {
      hooks: { onAssistantText },
    });
    await runAgentLoopCore(config);
    expect(onAssistantText).toHaveBeenCalledWith('reply', 'thought');
  });

  it('onAssistantText called with null thinking when absent', async () => {
    const onAssistantText = vi.fn();
    const config = minimalConfig(turnResponse({ text: 'x' }), { hooks: { onAssistantText } });
    await runAgentLoopCore(config);
    expect(onAssistantText).toHaveBeenCalledWith('x', null);
  });
});

// ── Non-streaming path: tool execution ───────────────────────────────────────

describe('runAgentLoopCore — non-streaming, tool execution', () => {
  it('callTool invoked for each tool call; onAfterToolCall fired after each', async () => {
    const call1 = toolCall('c1');
    const res1 = toolResult('c1');
    const callTool = vi.fn().mockResolvedValue(res1);
    const onAfterToolCall = vi.fn();

    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [call1] }))
      .mockResolvedValueOnce(turnResponse({ text: 'done' }));

    await runAgentLoopCore({ ...minimalConfig(turnResponse(), { invokeHandler, callTool }), hooks: { onAfterToolCall } });
    expect(callTool).toHaveBeenCalledWith(call1);
    expect(onAfterToolCall).toHaveBeenCalledWith(call1, res1);
  });

  it('onBeforeToolCalls fires with all calls before parallel execution', async () => {
    const c1 = toolCall('c1');
    const c2 = toolCall('c2');
    const callTool = vi.fn().mockResolvedValue(toolResult('c1'));
    const onBeforeToolCalls = vi.fn();

    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [c1, c2] }))
      .mockResolvedValueOnce(turnResponse({ text: 'done' }));

    await runAgentLoopCore({ ...minimalConfig(turnResponse(), { invokeHandler, callTool }), hooks: { onBeforeToolCalls } });
    expect(onBeforeToolCalls).toHaveBeenCalledWith([c1, c2]);
  });

  it('signal provided — tool results raced against AbortSignal', async () => {
    // Promise.race([toolResultsPromise, abortRace]) is always used since signal is required
    const call = toolCall('c1');
    const callTool = vi.fn().mockResolvedValue(toolResult('c1', 'echo', 'raced'));
    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [call] }))
      .mockResolvedValueOnce(turnResponse({ text: 'done' }));

    const ac = new AbortController();
    const config: AgentLoopCoreConfig = {
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: ac.signal,
      invokeHandler,
      callTool,
    };
    const res = await runAgentLoopCore(config);
    expect(res.toolCallCount).toBe(1);
  });

  it('signal aborts during Promise.race — rejects with DOMException', async () => {
    // callTool never resolves, so toolResultsPromise stays pending.
    // We abort while awaiting Promise.race([toolResultsPromise, abortRace]).
    const ac = new AbortController();
    const call = toolCall('c1');
    const callTool = vi.fn().mockImplementation(() => new Promise<ToolResult>(() => {}));
    const invokeHandler = vi.fn().mockResolvedValue(turnResponse({ text: '', toolCalls: [call] }));

    const runPromise = runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: ac.signal,
      invokeHandler,
      callTool,
    });

    // One microtask tick lets invokeHandler resolve and synchronous code up to
    // `await Promise.race(...)` run. The abort then wins the race.
    await Promise.resolve();
    ac.abort();

    await expect(runPromise).rejects.toThrow(DOMException);
  });

  it('signal aborted before tool race check — breaks loop, completed=false', async () => {
    // Covers `if (signal?.aborted) break;` between toolResultsPromise creation
    // and the Promise.race. Achieved by aborting synchronously before the async
    // continuation of invokeHandler runs, so signal is already aborted when the
    // synchronous check executes.
    const ac = new AbortController();
    const call = toolCall('c1');
    // callTool is called synchronously inside Promise.all(...map()) but we
    // don't need it to ever resolve for this test.
    const callTool = vi.fn().mockImplementation(() => new Promise<ToolResult>(() => {}));
    const invokeHandler = vi.fn().mockResolvedValue(turnResponse({ text: '', toolCalls: [call] }));

    const runPromise = runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: ac.signal,
      invokeHandler,
      callTool,
    });

    // Abort synchronously (before invokeHandler's microtask has resolved).
    // When the continuation runs: toolResultsPromise is created, THEN
    // `if (signal?.aborted) break` fires — loop exits without throwing.
    ac.abort();

    const result = await runPromise;
    expect(result.completed).toBe(false);
    // The assistant message from turn 0 is still pushed before the signal check fires
    expect(result.turns).toBe(1);
  });

  it('onAfterTurn called after tool results are appended', async () => {
    // Covers the second "if (onAfterTurn)" in the non-streaming tool path (line ~235)
    const call = toolCall('c1');
    const res = toolResult('c1');
    const callTool = vi.fn().mockResolvedValue(res);
    const onAfterTurn = vi.fn().mockResolvedValue(undefined);

    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: 'thinking', toolCalls: [call] }))
      .mockResolvedValueOnce(turnResponse({ text: 'final' }));

    await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: new AbortController().signal,
      invokeHandler,
      callTool,
      hooks: { onAfterTurn },
    });

    // onAfterTurn should be called for BOTH turns (tool-execution turn + final turn)
    expect(onAfterTurn).toHaveBeenCalledTimes(2);
    // Second call (final turn, no tools) — history has user+assistant(tool)+tool+assistant(final)
    const [histArg] = onAfterTurn.mock.calls[1];
    const roles = histArg.map((m: { role: string }) => m.role);
    expect(roles).toContain('tool');
  });

  it('onAfterTurn compaction after tool execution replaces history for next turn', async () => {
    const call = toolCall('c1');
    const callTool = vi.fn().mockResolvedValue(toolResult('c1'));
    let turnCount = 0;
    const onAfterTurn = vi.fn().mockImplementation(async () => {
      turnCount++;
      if (turnCount === 1) {
        // Compact history after tool turn to just the user message
        return [{ role: 'user' as const, content: 'compacted after tools' }];
      }
      return undefined;
    });

    let secondCallHistory: { role: string }[] = [];
    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [call] }))
      .mockImplementationOnce(async (msgs: { role: string }[]) => {
        secondCallHistory = [...msgs];
        return turnResponse({ text: 'final' });
      });

    await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: new AbortController().signal,
      invokeHandler,
      callTool,
      hooks: { onAfterTurn },
    });

    // Second handler call should receive the compacted history, not the full one
    expect(secondCallHistory).toEqual([{ role: 'user', content: 'compacted after tools' }]);
  });

  // ── onTurnSnapshot ──────────────────────────────────────────────────────

  describe('onTurnSnapshot hook (non-streaming)', () => {
    it('fires with the correct history when tool calls are present', async () => {
      const call = toolCall('c1');
      const callTool = vi.fn().mockResolvedValue(toolResult('c1'));
      const onTurnSnapshot = vi.fn();

      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(turnResponse({ text: 'analysis', toolCalls: [call], thinking: 'deep thought' }))
        .mockResolvedValueOnce(turnResponse({ text: 'final' }));

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'task' }],
        maxTurns: 10,
        signal: new AbortController().signal,
        invokeHandler,
        callTool,
        hooks: { onTurnSnapshot },
      });

      // Should fire exactly once (for the turn with tool calls, not the final turn)
      expect(onTurnSnapshot).toHaveBeenCalledTimes(1);

      // The snapshot should include the assistant message with text, thinking, and toolCalls
      const [snapshot] = onTurnSnapshot.mock.calls[0] as [AgentMessage[]];
      expect(snapshot.length).toBeGreaterThanOrEqual(2);
      const assistantMsg = snapshot[snapshot.length - 1];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBe('analysis');
      expect((assistantMsg as { thinking?: string }).thinking).toBe('deep thought');
      expect((assistantMsg as { toolCalls?: unknown[] }).toolCalls).toHaveLength(1);
    });

    it('does NOT fire when no tool calls are produced (natural completion)', async () => {
      const onTurnSnapshot = vi.fn();
      const invokeHandler = vi.fn().mockResolvedValue(turnResponse({ text: 'done' }));

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'hello' }],
        maxTurns: 10,
        signal: new AbortController().signal,
        invokeHandler: invokeHandler,
        callTool: vi.fn(),
        hooks: { onTurnSnapshot },
      });

      expect(onTurnSnapshot).not.toHaveBeenCalled();
    });

    it('fires before onBeforeToolCalls (correct ordering)', async () => {
      const call = toolCall('c1');
      const callTool = vi.fn().mockResolvedValue(toolResult('c1'));
      const callOrder: string[] = [];
      const onTurnSnapshot = vi.fn(() => { callOrder.push('onTurnSnapshot'); });
      const onBeforeToolCalls = vi.fn(() => { callOrder.push('onBeforeToolCalls'); });

      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [call] }))
        .mockResolvedValueOnce(turnResponse({ text: 'final' }));

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'task' }],
        maxTurns: 10,
        signal: new AbortController().signal,
        invokeHandler,
        callTool,
        hooks: { onTurnSnapshot, onBeforeToolCalls },
      });

      expect(callOrder).toEqual(['onTurnSnapshot', 'onBeforeToolCalls']);
    });

    it('fires per-turn when multiple turns produce tool calls', async () => {
      const call = toolCall('c1');
      const callTool = vi.fn().mockResolvedValue(toolResult('c1'));
      const onTurnSnapshot = vi.fn();

      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(turnResponse({ text: 'turn0', toolCalls: [call] }))
        .mockResolvedValueOnce(turnResponse({ text: 'turn1', toolCalls: [call] }))
        .mockResolvedValueOnce(turnResponse({ text: 'final' }));

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'task' }],
        maxTurns: 10,
        signal: new AbortController().signal,
        invokeHandler,
        callTool,
        hooks: { onTurnSnapshot },
      });

      expect(onTurnSnapshot).toHaveBeenCalledTimes(2);
    });

    it('receives a fresh array copy (mutation-safe)', async () => {
      const call = toolCall('c1');
      const callTool = vi.fn().mockResolvedValue(toolResult('c1'));
      const captured: AgentMessage[][] = [];

      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(turnResponse({ text: 'a', toolCalls: [call] }))
        .mockResolvedValueOnce(turnResponse({ text: 'final' }));

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'task' }],
        maxTurns: 10,
        signal: new AbortController().signal,
        invokeHandler,
        callTool,
        hooks: {
          onTurnSnapshot(history) {
            captured.push(history);
          },
        },
      });

      // The captured snapshot should not be the same reference as the one
      // agentLoopCore continues to modify (tool results appended later)
      expect(captured.length).toBe(1);
      const snapshot = captured[0];
      // Snapshot should NOT contain tool results (they come after)
      expect(snapshot.every((m) => m.role !== 'tool')).toBe(true);
    });
  });
});

// ── Streaming path ────────────────────────────────────────────────────────────

describe('runAgentLoopCore — streaming path', () => {
  beforeEach(() => {
    mockDrain.mockReset();
    // Default: a mock that calls onBeforeAwaitResults so onTurnSnapshot fires.
    // Tests that need different behavior override with their own mock setup.
    mockDrain.mockImplementation(async (_stream: ReadableStream<AgentStreamChunk>, _exec: (call: ToolCall) => Promise<ToolResult>, _sig: AbortSignal, hooks?: AgentStreamHooks) => {
      const result = streamResult({ text: 'stream output', shouldContinue: false });
      (hooks?.onBeforeAwaitResults as ((t: string, th: string, tc: readonly ToolCall[]) => void) | undefined)
        ?.(result.text, result.thinking, result.toolCalls);
      return result;
    });
  });

  it('onStreamEnd called after drainAgentStream resolves', async () => {
    mockDrain.mockResolvedValue(streamResult({ text: 'stream output', shouldContinue: false }));
    const onStreamEnd = vi.fn();
    await runAgentLoopCore({
      ...minimalConfig(turnResponse(), { invokeHandler: vi.fn().mockResolvedValue(makeStream()) }),
      hooks: { onStreamEnd },
    });
    expect(onStreamEnd).toHaveBeenCalledOnce();
  });

  it('completed=true when shouldContinue=false', async () => {
    mockDrain.mockResolvedValue(streamResult({ text: 'done', shouldContinue: false }));
    const res = await runAgentLoopCore({
      ...minimalConfig(turnResponse(), { invokeHandler: vi.fn().mockResolvedValue(makeStream()) }),
    });
    expect(res.completed).toBe(true);
  });

  it('completed=false when shouldContinue=true but maxTurns reached', async () => {
    mockDrain.mockResolvedValue(streamResult({ text: '', shouldContinue: true }));
    const invokeHandler = vi.fn().mockResolvedValue(makeStream());
    const res = await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 2,
      signal: new AbortController().signal,
      invokeHandler,
      callTool: vi.fn(),
    });
    expect(res.completed).toBe(false);
    expect(invokeHandler).toHaveBeenCalledTimes(2);
  });

  it('onAfterTurn called in streaming path with usage from drain result', async () => {
    const usage = { promptTokens: 50, completionTokens: 20, totalTokens: 70 };
    mockDrain.mockResolvedValue(streamResult({ text: 'ok', usage, shouldContinue: false }));
    const onAfterTurn = vi.fn().mockResolvedValue(undefined);
    await runAgentLoopCore({
      ...minimalConfig(turnResponse(), { invokeHandler: vi.fn().mockResolvedValue(makeStream()) }),
      hooks: { onAfterTurn },
    });
    expect(onAfterTurn).toHaveBeenCalledOnce();
    expect(onAfterTurn.mock.calls[0][1]).toEqual(usage);
  });

  it('onAfterTurn compaction replaces history in streaming path', async () => {
    const c = toolCall('cs1');
    const r = toolResult('cs1', 'echo', 'ok');
    const compacted = [{ role: 'user' as const, content: 'slim' }];
    const onAfterTurn = vi.fn().mockResolvedValue(compacted);

    mockDrain
      .mockResolvedValueOnce(streamResult({
        text: '', toolCalls: [c], toolResultPairs: [{ call: c, result: r }], shouldContinue: true,
      }))
      .mockResolvedValueOnce(streamResult({ text: 'final', shouldContinue: false }));

    let secondCallHistory: { role: string }[] = [];
    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(makeStream())
      .mockImplementationOnce(async (msgs: { role: string }[]) => {
        secondCallHistory = [...msgs];
        return makeStream();
      });

    await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: new AbortController().signal,
      invokeHandler,
      callTool: vi.fn(),
      hooks: { onAfterTurn },
    });

    expect(secondCallHistory).toEqual(compacted);
  });

  it('onAfterToolCall fires for SDK-executed calls (not pre-executed)', async () => {
    const sdkCall = toolCall('sdk1');
    const sdkRes = toolResult('sdk1', 'echo', 'result');
    // No calls to onPreExecutedResult — preExecutedIds stays empty — onAfterToolCall fires
    mockDrain.mockResolvedValue(
      streamResult({ text: '', toolCalls: [sdkCall], toolResultPairs: [{ call: sdkCall, result: sdkRes }], shouldContinue: false }),
    );
    const onAfterToolCall = vi.fn();
    await runAgentLoopCore({
      ...minimalConfig(turnResponse(), { invokeHandler: vi.fn().mockResolvedValue(makeStream()) }),
      hooks: { onAfterToolCall },
    });
    expect(onAfterToolCall).toHaveBeenCalledWith(sdkCall, sdkRes);
  });

  it('attachments on stream result included in assistant history entry', async () => {
    const att = { type: 'image' as const, url: 'data:image/png;base64,abc' };
    mockDrain.mockResolvedValue({
      text: 'here', thinking: '', toolCalls: [], toolResultPairs: [],
      // @ts-expect-error — attachments are not actually part of AgentMessage, but we want to test that they get merged in correctly
      attachments: [att], usage: undefined, shouldContinue: false,
    });
    const res = await runAgentLoopCore({
      ...minimalConfig(turnResponse(), { invokeHandler: vi.fn().mockResolvedValue(makeStream()) }),
    });
    // The assistant message in history should carry the attachments array
    const assistantMsg = res.history.find((m) => m.role === 'assistant');
    expect((assistantMsg as { attachments?: unknown[] }).attachments).toEqual([att]);
  });

  it('attachments on tool result included in tool history entry', async () => {
    const call = toolCall('tc1');
    const att = { type: 'image' as const, url: 'data:image/png;base64,xyz' };
    const res = { toolCallId: 'tc1', name: 'echo', result: 'ok', attachments: [att] };
    mockDrain.mockResolvedValue({
      // @ts-expect-error — attachments are not actually part of AgentStreamChunk, but we want to test that they get merged in correctly
      text: '', thinking: '', toolCalls: [call], toolResultPairs: [{ call, result: res }],
      attachments: [], usage: undefined, shouldContinue: false,
    });
    const result = await runAgentLoopCore({
      ...minimalConfig(turnResponse(), { invokeHandler: vi.fn().mockResolvedValue(makeStream()) }),
    });
    const toolMsg = result.history.find((m) => m.role === 'tool');
    expect((toolMsg as { attachments?: unknown[] }).attachments).toEqual([att]);
  });

  it('onAfterToolCall NOT fired for pre-executed calls', async () => {
    const preCall = toolCall('pre1');
    const preRes = toolResult('pre1', 'echo', 'pre-exec');

    // drainAgentStream calls onPreExecutedResult for preCall — adds to preExecutedIds
    mockDrain.mockImplementation(async (_stream, _exec, _sig, hooks) => {
      hooks?.onPreExecutedResult?.(preCall, preRes);
      return streamResult({ text: '', toolCalls: [preCall], toolResultPairs: [{ call: preCall, result: preRes }], shouldContinue: false });
    });

    const onAfterToolCall = vi.fn();
    await runAgentLoopCore({
      ...minimalConfig(turnResponse(), { invokeHandler: vi.fn().mockResolvedValue(makeStream()) }),
      hooks: { onAfterToolCall },
    });
    expect(onAfterToolCall).not.toHaveBeenCalled();
  });

  // ── onBeforeInvoke hook ─────────────────────────────────────────────────────

  describe('onBeforeInvoke hook', () => {
    it('injects pending messages into history before handler is called', async () => {
      const onBeforeInvoke = vi.fn()
        .mockReturnValueOnce([{ role: 'user', content: 'interjection 1' }])
        .mockReturnValue([]); // subsequent turns — nothing pending

      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(turnResponse({ text: 'reply to both' }));

      const res = await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'original message' }],
        maxTurns: 1,
        signal: new AbortController().signal,
        invokeHandler,
        callTool: vi.fn(),
        hooks: { onBeforeInvoke },
      });

      // The handler should have received the original message + the injected one
      expect(onBeforeInvoke).toHaveBeenCalled();
      const historyArg = invokeHandler.mock.calls[0][0];
      expect(historyArg).toHaveLength(2);
      expect(historyArg[0]).toMatchObject({ role: 'user', content: 'original message' });
      expect(historyArg[1]).toMatchObject({ role: 'user', content: 'interjection 1' });
    });

    it('injects multiple pending messages per turn', async () => {
      const pending = [
        { role: 'user' as const, content: 'interjection 1' },
        { role: 'user' as const, content: 'interjection 2' },
      ];
      const onBeforeInvoke = vi.fn()
        .mockReturnValueOnce(pending)
        .mockReturnValue([]);

      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(turnResponse({ text: 'combined reply' }));

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'original' }],
        maxTurns: 1,
        signal: new AbortController().signal,
        invokeHandler,
        callTool: vi.fn(),
        hooks: { onBeforeInvoke },
      });

      const historyArg = invokeHandler.mock.calls[0][0];
      expect(historyArg).toHaveLength(3);
      expect(historyArg[0]).toMatchObject({ role: 'user', content: 'original' });
      expect(historyArg[1]).toMatchObject({ role: 'user', content: 'interjection 1' });
      expect(historyArg[2]).toMatchObject({ role: 'user', content: 'interjection 2' });
    });

    it('returns [] when not configured (backward compat)', async () => {
      // No onBeforeInvoke in hooks — should behave identically
      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(turnResponse({ text: 'ok' }));

      const res = await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'hello' }],
        maxTurns: 1,
        signal: new AbortController().signal,
        invokeHandler,
        callTool: vi.fn(),
      });

      expect(res.output).toBe('ok');
      expect(res.completed).toBe(true);
    });
  });

  // ── Final output fallback ──────────────────────────────────────────────────

  describe('final output fallback when last turn produced only tool calls', () => {
    it('returns last non-empty assistant text when finalText is empty', async () => {
      // Simulate: turn 0 has helper text; turn 1 & 2 have only tool calls (empty text).
      // maxTurns=3 — loop exhausts, output should fall back to "found the data".
      const call = toolCall('tc1');
      const result = toolResult('tc1', 'echo', 'the answer');

      // Turn 0: non-streaming with text + tool call
      // Turn 1: streaming, shouldContinue=true (tool calls made), empty text
      // Turn 2: streaming, shouldContinue=true (tool calls made), empty text — maxTurns hit
      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(turnResponse({ text: 'found the data', toolCalls: [call] }))
        .mockResolvedValueOnce(makeStream())
        .mockResolvedValueOnce(makeStream());

      mockDrain
        .mockResolvedValueOnce(streamResult({
          text: '', toolCalls: [call], toolResultPairs: [{ call, result }],
          shouldContinue: true,
        }))
        .mockResolvedValueOnce(streamResult({
          text: '', toolCalls: [call], toolResultPairs: [{ call, result }],
          shouldContinue: true,
        }));

      const res = await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'research topic' }],
        maxTurns: 3,
        signal: new AbortController().signal,
        invokeHandler,
        callTool: vi.fn().mockResolvedValue(result),
      });

      expect(res.completed).toBe(false);
      // finalText is '' (last turn had no text), so it falls back to
      // the last non-empty assistant text: "found the data"
      expect(res.output).toBe('found the data');
    });

    it('generates descriptive message when no assistant ever produced text', async () => {
      const call = toolCall('tc1');
      const result = toolResult('tc1', 'echo', 'data');

      const invokeHandler = vi.fn().mockResolvedValue(makeStream());
      mockDrain.mockResolvedValue(streamResult({
        text: '', toolCalls: [call], toolResultPairs: [{ call, result }],
        shouldContinue: true,
      }));

      const res = await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'task' }],
        maxTurns: 2,
        signal: new AbortController().signal,
        invokeHandler,
        callTool: vi.fn().mockResolvedValue(result),
      });

      expect(res.completed).toBe(false);
      expect(res.output).toMatch(/completed \d+ tool call\(s\)/);
      expect(res.output).toContain('No summary text was produced');
    });
  });

  // ── onTurnSnapshot (streaming path) ────────────────────────────────────

  describe('onTurnSnapshot (streaming path)', () => {
    it('fires via onBeforeAwaitResults when tool calls are in the stream', async () => {
      const call = toolCall('c1');
      const result = toolResult('c1', 'ask_user');

      mockDrain.mockImplementation(async (_stream: ReadableStream<AgentStreamChunk>, _exec: (call: ToolCall) => Promise<ToolResult>, _sig: AbortSignal, hooks?: AgentStreamHooks) => {
        // Call onBeforeAwaitResults with text, thinking, and toolCalls
        (hooks?.onBeforeAwaitResults as ((t: string, th: string, tc: readonly ToolCall[]) => void) | undefined)
          ?.('analysis', 'deep thinking', [call]);
        return streamResult({
          text: 'analysis', thinking: 'deep thinking', toolCalls: [call],
          toolResultPairs: [{ call, result }], shouldContinue: true,
        });
      });

      const onTurnSnapshot = vi.fn();
      const onAfterTurn = vi.fn().mockResolvedValue(undefined);

      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(makeStream())
        .mockResolvedValueOnce(turnResponse({ text: 'final' }));

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'task' }],
        maxTurns: 10,
        signal: new AbortController().signal,
        invokeHandler,
        callTool: vi.fn().mockResolvedValue(result),
        hooks: { onTurnSnapshot, onAfterTurn },
      });

      expect(onTurnSnapshot).toHaveBeenCalledTimes(1);

      // Verify the snapshot includes the constructed assistant message
      const [snapshot] = onTurnSnapshot.mock.calls[0] as [AgentMessage[]];
      expect(snapshot.length).toBeGreaterThanOrEqual(2);
      const assistantMsg = snapshot[snapshot.length - 1];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBe('analysis');
      expect((assistantMsg as { thinking?: string }).thinking).toBe('deep thinking');
      expect((assistantMsg as { toolCalls?: readonly ToolCall[] }).toolCalls).toHaveLength(1);
      // Snapshot should NOT contain tool results (they haven't been awaited yet)
      expect(snapshot.every((m) => m.role !== 'tool')).toBe(true);
    });

    it('does NOT fire when stream has no tool calls', async () => {
      mockDrain.mockImplementation(async (_stream: ReadableStream<AgentStreamChunk>, _exec: (call: ToolCall) => Promise<ToolResult>, _sig: AbortSignal, hooks?: AgentStreamHooks) => {
        // No onBeforeAwaitResults call — no tools in this stream
        return streamResult({ text: 'plain text', shouldContinue: false });
      });

      const onTurnSnapshot = vi.fn();

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'hello' }],
        maxTurns: 10,
        signal: new AbortController().signal,
        invokeHandler: vi.fn().mockResolvedValue(makeStream()),
        callTool: vi.fn(),
        hooks: { onTurnSnapshot },
      });

      expect(onTurnSnapshot).not.toHaveBeenCalled();
    });

    it('provides a mutation-safe copy (not the same reference as loop history)', async () => {
      const call = toolCall('c1');
      const result = toolResult('c1', 'echo');
      let captured: AgentMessage[] | null = null;

      mockDrain.mockImplementation(async (_stream: ReadableStream<AgentStreamChunk>, _exec: (call: ToolCall) => Promise<ToolResult>, _sig: AbortSignal, hooks?: AgentStreamHooks) => {
        (hooks?.onBeforeAwaitResults as ((t: string, th: string, tc: readonly ToolCall[]) => void) | undefined)
          ?.('text', '', [call]);
        return streamResult({
          text: '', toolCalls: [call], toolResultPairs: [{ call, result }],
          shouldContinue: true,
        });
      });

      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(makeStream())
        .mockResolvedValueOnce(turnResponse({ text: 'final' }));

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'task' }],
        maxTurns: 10,
        signal: new AbortController().signal,
        invokeHandler,
        callTool: vi.fn().mockResolvedValue(result),
        hooks: {
          onTurnSnapshot(history) { captured = history; },
        },
      });

      // Captured snapshot should NOT contain tool results
      expect(captured).not.toBeNull();
      expect(captured!.every((m) => m.role !== 'tool')).toBe(true);
    });

    it('fires before onStreamEnd (correct ordering)', async () => {
      const call = toolCall('c1');
      const result = toolResult('c1', 'echo');
      const callOrder: string[] = [];

      mockDrain.mockImplementation(async (_stream: ReadableStream<AgentStreamChunk>, _exec: (call: ToolCall) => Promise<ToolResult>, _sig: AbortSignal, hooks?: AgentStreamHooks) => {
        (hooks?.onBeforeAwaitResults as ((t: string, th: string, tc: readonly ToolCall[]) => void) | undefined)
          ?.('text', '', [call]);
        return streamResult({
          text: '', toolCalls: [call], toolResultPairs: [{ call, result }],
          shouldContinue: true,
        });
      });

      const invokeHandler = vi.fn()
        .mockResolvedValueOnce(makeStream())
        .mockResolvedValueOnce(turnResponse({ text: 'final' }));

      await runAgentLoopCore({
        initialHistory: [{ role: 'user', content: 'task' }],
        maxTurns: 10,
        signal: new AbortController().signal,
        invokeHandler,
        callTool: vi.fn().mockResolvedValue(result),
        hooks: {
          onTurnSnapshot: vi.fn(() => { callOrder.push('onTurnSnapshot'); }),
          onStreamEnd: vi.fn(() => { callOrder.push('onStreamEnd'); }),
        },
      });

      // onTurnSnapshot fires during drainAgentStream, onStreamEnd fires after
      expect(callOrder).toEqual(['onTurnSnapshot', 'onStreamEnd']);
    });
  });
});

// ── Edge case: Mixed concurrency (safe + unsafe calls) ──────────────────────

describe('runAgentLoopCore — mixed concurrency (safe + unsafe tool calls)', () => {
  it('executes safe calls in parallel, unsafe calls sequentially', async () => {
    const safeCall = toolCall('safe-1');
    const unsafeCall = toolCall('unsafe-1');
    const safeResult = toolResult('safe-1');
    const unsafeResult = toolResult('unsafe-1');
    const execOrder: string[] = [];

    const callTool = vi.fn().mockImplementation(async (call: ToolCall) => {
      execOrder.push(call.id);
      if (call.id === 'unsafe-1') {
        // Unsafe calls are sequential — await a tick so ordering is visible
        await new Promise((r) => setTimeout(r, 10));
      }
      return call.id === 'safe-1' ? safeResult : unsafeResult;
    });

    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [safeCall, unsafeCall] }))
      .mockResolvedValueOnce(turnResponse({ text: 'done' }));

    // Make unsafeCall resolveTool.isConcurrencySafe = false
    const resolveTool = vi.fn().mockImplementation((name: string) => {
      if (name === 'unsafe-1') return { name: 'unsafe-1', isConcurrencySafe: false } as any;
      return { name, isConcurrencySafe: true } as any;
    });

    await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: new AbortController().signal,
      invokeHandler,
      callTool,
      resolveTool,
    });

    // Both safe+unsafe paths executed — toolResults is populated
    expect(execOrder).toContain('safe-1');
    expect(execOrder).toContain('unsafe-1');
  });
});

// ── Edge case: callTool throws error (safe executor catch) ──────────────────

describe('runAgentLoopCore — callTool error handling', () => {
  it('createSafeExecutor catches errors and returns Error result', async () => {
    const call = toolCall('c1');
    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [call] }))
      .mockResolvedValueOnce(turnResponse({ text: 'done' }));

    const callTool = vi.fn().mockRejectedValue(new Error('tool crashed'));

    const res = await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: new AbortController().signal,
      invokeHandler,
      callTool,
    });

    expect(res.toolCallCount).toBe(1);
    // Tool result in history should have Error prefix
    const toolHistory = res.history.find((m) => m.role === 'tool');
    expect((toolHistory as any)?.content).toMatch(/^Error: /);
  });

  it('onAfterToolCall fires for error results', async () => {
    const call = toolCall('c1');
    const onAfterToolCall = vi.fn();
    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [call] }))
      .mockResolvedValueOnce(turnResponse({ text: 'done' }));

    await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: new AbortController().signal,
      invokeHandler,
      callTool: vi.fn().mockRejectedValue(new Error('fail')),
      hooks: { onAfterToolCall },
    });

    expect(onAfterToolCall).toHaveBeenCalled();
    const resultArg = onAfterToolCall.mock.calls[0][1];
    expect(resultArg.result).toMatch(/^Error: /);
  });
});

// ── Edge case: toolCallId mismatch in history push ─────────────────────────

describe('runAgentLoopCore — toolCallId fallback when caller id missing', () => {
  it('falls back to toolCallId when call not found in turnToolCalls', async () => {
    const call = toolCall('c1');
    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [call] }))
      .mockResolvedValueOnce(turnResponse({ text: 'done' }));

    // Return a result with a DIFFERENT toolCallId than the original call
    const callTool = vi.fn().mockResolvedValue({ toolCallId: 'c2', name: 'echo', result: 'fallback' });

    const res = await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: new AbortController().signal,
      invokeHandler,
      callTool,
    });

    expect(res.toolCallCount).toBe(1);
    // The fallback in pushToolResultsToHistory should use { id: res.toolCallId, name: res.name, arguments: {} }
    const toolMsg = res.history.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect((toolMsg as any).toolCallId).toBe('c2');
  });
});

// ── Edge case: resolveTool returns undefined (default concurrency safe = true) ─

describe('runAgentLoopCore — resolveTool returns undefined', () => {
  it('defaults isConcurrencySafe to true when resolveTool returns undefined', async () => {
    const call1 = toolCall('c1');
    const call2 = toolCall('c2');
    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [call1, call2] }))
      .mockResolvedValueOnce(turnResponse({ text: 'done' }));

    const callTool = vi.fn().mockResolvedValue(toolResult('c1'));
    const resolveTool = vi.fn().mockReturnValue(undefined);

    // When resolveTool returns undefined, every() passes, so parallel path runs
    const res = await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: new AbortController().signal,
      invokeHandler,
      callTool,
      resolveTool,
    });

    expect(res.toolCallCount).toBe(2);
    expect(callTool).toHaveBeenCalledTimes(2);
  });
});

// ── Edge case: all-unsafe calls (no safe batch) ────────────────────────────

describe('runAgentLoopCore — all-unsafe tool calls', () => {
  it('still executes all calls when none are concurrency-safe', async () => {
    const call1 = toolCall('u1');
    const call2 = toolCall('u2');

    const callTool = vi.fn().mockResolvedValue({ toolCallId: 'u1', name: 'echo', result: 'ok' });

    const invokeHandler = vi.fn()
      .mockResolvedValueOnce(turnResponse({ text: '', toolCalls: [call1, call2] }))
      .mockResolvedValueOnce(turnResponse({ text: 'done' }));

    const resolveTool = vi.fn().mockReturnValue({ isConcurrencySafe: false } as any);

    const res = await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 10,
      signal: new AbortController().signal,
      invokeHandler,
      callTool,
      resolveTool,
    });

    expect(res.toolCallCount).toBe(2);
    expect(callTool).toHaveBeenCalledTimes(2);
  });
});

// ── Edge case: empty fallback output ───────────────────────────────────────

describe('runAgentLoopCore — empty output fallback', () => {
  it('returns empty string when no text and no tool calls', async () => {
    const invokeHandler = vi.fn().mockResolvedValue(turnResponse({ text: '' }));
    const res = await runAgentLoopCore({
      initialHistory: [{ role: 'user', content: 'task' }],
      maxTurns: 1,
      signal: new AbortController().signal,
      invokeHandler,
      callTool: vi.fn(),
    });
    expect(res.output).toBe('');
    expect(res.completed).toBe(true);
  });
});
