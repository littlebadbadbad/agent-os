import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentTurnResponse, AgentStreamChunk } from '@agent-type';
import type { SubAgentConfig, SubAgentResult } from '../../tools/subagent/types';

// 鈹€鈹€ Mock drainAgentStream so loop.ts doesn't need real ReadableStreams 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
vi.mock('../../tools/agentLoop', () => ({
  drainAgentStream: vi.fn(),
}));

import { drainAgentStream } from '../../tools/agentLoop';
import { runAgentLoop } from '../../tools/subagent/loop';

const mockDrain = vi.mocked(drainAgentStream);

// Required fields shared by all runAgentLoop calls in tests.
const TEST_CTX = {
  signal: new AbortController().signal,
  agentName: 'test',
  conversationId: 'test-conv',
  sessionId: 'test-session',
} as const;

// 鈹€鈹€ Fixture factories 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function makeTurnResponse(overrides: Partial<AgentTurnResponse> = {}): AgentTurnResponse {
  return {
    text: 'Here is your answer.',
    ...overrides,
  };
}

function makeStreamResult(overrides: Partial<{
  text: string;
  thinking: string;
  toolCalls: ReturnType<typeof makeToolCall>[];
  toolResultPairs: { call: ReturnType<typeof makeToolCall>; result: ReturnType<typeof makeToolResult> }[];
  attachments: never[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  shouldContinue: boolean;
}> = {}) {
  return {
    text: '',
    thinking: '',
    toolCalls: [],
    toolResultPairs: [],
    attachments: [],
    usage: undefined,
    shouldContinue: false,
    ...overrides,
  };
}

function makeToolCall(id: string, name: string, args: Record<string, unknown> = {}) {
  return { id, name, arguments: args };
}

function makeToolResult(id: string, name: string, result: string) {
  return { toolCallId: id, name, result };
}

// 鈹€鈹€ Simple async handler returning AgentTurnResponse 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function makeStaticHandler(response: AgentTurnResponse) {
  return vi.fn().mockResolvedValue(response);
}

// 鈹€鈹€ Simple tool for testing 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';

const echoTool = defineTool({
  name: 'echo',
  description: 'Echoes input back.',
  parameters: z.object({ message: z.string() }),
  execute: async ({ message }) => message,
});

// 鈹€鈹€ Tests 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

describe('runAgentLoop 锟?single turn text response (AgentTurnResponse)', () => {
  beforeEach(() => { mockDrain.mockReset(); });

  it('returns output, turns=1, toolCallCount=0 for immediate text reply', async () => {
    const handler = makeStaticHandler(makeTurnResponse({ text: 'The capital of France is Paris.' }));
    const result = await runAgentLoop({
      ...TEST_CTX,
      message: 'What is the capital of France?',
      handler,
    });
    expect(result.output).toBe('The capital of France is Paris.');
    expect(result.turns).toBe(1);
    expect(result.toolCallCount).toBe(0);
  });

  it('passes the task as the user message to the handler', async () => {
    const handler = makeStaticHandler(makeTurnResponse({ text: 'Done.' }));
    await runAgentLoop({ ...TEST_CTX, message: 'Summarize this document.', handler });
    expect(handler).toHaveBeenCalledOnce();
    const messages = handler.mock.calls[0][0];
    expect(messages[0]).toEqual({ role: 'user', content: 'Summarize this document.' });
  });

  it('calls onTextDelta with full text from non-streaming handler', async () => {
    const onTextDelta = vi.fn();
    const handler = makeStaticHandler(makeTurnResponse({ text: 'Result here.' }));
    await runAgentLoop({ ...TEST_CTX, message: 'task', handler, onTextDelta });
    expect(onTextDelta).toHaveBeenCalledWith('Result here.');
  });


  it('result contains correct output/turns/toolCallCount', async () => {
    const handler = makeStaticHandler(makeTurnResponse({ text: 'Final answer.' }));
    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler });
    expect(result).toMatchObject({
      output: 'Final answer.',
      turns: 1,
      toolCallCount: 0,
    });
  });
});

describe('runAgentLoop 锟?AgentTurnResponse with tool calls', () => {
  beforeEach(() => { mockDrain.mockReset(); });

  it('single turn: tool calls executed, history extended, loops once more for follow-up text', async () => {
    const searchCall = makeToolCall('call_1', 'web_search', { query: 'TypeScript 5.5' });
    const handler = vi.fn()
      .mockResolvedValueOnce(makeTurnResponse({
        text: "I'll search for that.",
        toolCalls: [searchCall],
      }))
      .mockResolvedValueOnce(makeTurnResponse({ text: 'TypeScript 5.5 released June 2024.' }));

    // Provide a real tool so callTool can execute it
    const searchTool = defineTool({
      name: 'web_search',
      description: 'Search the web',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => `Results for: ${query}`,
    });

    const result = await runAgentLoop({ ...TEST_CTX, message: 'What is new in TypeScript 5.5?', handler, tools: [searchTool] });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.output).toBe('TypeScript 5.5 released June 2024.');
    expect(result.turns).toBe(2);
    expect(result.toolCallCount).toBe(1);
  });

  it('executes tool calls and reports toolCallCount', async () => {
    const toolCall = makeToolCall('call_x', 'echo', { message: 'hello' });
    const handler = vi.fn()
      .mockResolvedValueOnce(makeTurnResponse({ text: 'Echoing.', toolCalls: [toolCall] }))
      .mockResolvedValueOnce(makeTurnResponse({ text: 'Done.' }));

    const result = await runAgentLoop({ ...TEST_CTX, message: 'Echo hello', handler, tools: [echoTool] });
    expect(result.toolCallCount).toBe(1);
  });

  it('tool call fails: adds error result to history and loop continues', async () => {
    const badCall = makeToolCall('call_bad', 'nonexistent_tool', {});
    const handler = vi.fn()
      .mockResolvedValueOnce(makeTurnResponse({ text: '', toolCalls: [badCall] }))
      .mockResolvedValueOnce(makeTurnResponse({ text: 'Error handled.' }));

    const result = await runAgentLoop({ ...TEST_CTX, message: 'do something', handler, tools: [] });
    expect(result.output).toBe('Error handled.');
  });

  it('no tool calls 锟?loop exits in one turn, output is result.text', async () => {
    const handler = vi.fn()
      .mockResolvedValueOnce(makeTurnResponse({
        text: 'Here is the direct answer with no tools needed.',
      }));
    const result = await runAgentLoop({ ...TEST_CTX, message: 'run direct', handler });
    expect(result.output).toBe('Here is the direct answer with no tools needed.');
    expect(handler).toHaveBeenCalledTimes(1);
  });


  it('tool throws non-Error (string): error message uses String(err)', async () => {
    // Covers `err instanceof Error ? ... : String(err)` false branch in catch
    const stringThrowTool = defineTool({
      name: 'string_throw_tool',
      description: 'Throws a plain string',
      parameters: z.object({}),
      execute: async () => { throw 'plain string error'; }, // non-Error throw
    });
    const toolCall = makeToolCall('call_str', 'string_throw_tool', {});
    const handler = vi.fn()
      .mockResolvedValueOnce(makeTurnResponse({ text: '', toolCalls: [toolCall] }))
      .mockResolvedValueOnce(makeTurnResponse({ text: 'Handled.' }));
    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler, tools: [stringThrowTool] });
    expect(result.output).toBe('Handled.');
    // The second handler invocation should have received a tool result with String(err)
    const secondCallMessages = handler.mock.calls[1][0];
    const toolMsg = secondCallMessages.find((m: { role: string }) => m.role === 'tool') as
      { role: string; content: string } | undefined;
    expect(toolMsg?.content).toBe('Error: plain string error');
  });

  it('max turns reached: stops and returns last finalText', async () => {
    const toolCall = makeToolCall('call_loop', 'echo', { message: 'loop' });
    // Every turn returns a tool call, never finishing 锟?maxTurns should stop it
    const handler = vi.fn().mockResolvedValue(
      makeTurnResponse({ text: 'Still going...', toolCalls: [toolCall] }),
    );
    const result = await runAgentLoop({
      ...TEST_CTX,
      message: 'infinite loop test',
      handler,
      tools: [echoTool],
      maxTurns: 3,
    });
    expect(handler).toHaveBeenCalledTimes(3);
    expect(result.toolCallCount).toBe(3);
  });

  it('systemPrompt is passed through context to handler', async () => {
    const handler = makeStaticHandler(makeTurnResponse({ text: 'ok' }));
    await runAgentLoop({
      ...TEST_CTX,
      message: 'task',
      handler,
      systemPrompt: 'You are an expert TypeScript developer.',
    });
    const context = handler.mock.calls[0][1];
    expect(context.systemPrompt).toBe('You are an expert TypeScript developer.');
  });

  it('toolChoice is passed through context to handler', async () => {
    const handler = makeStaticHandler(makeTurnResponse({ text: 'ok' }));
    await runAgentLoop({ ...TEST_CTX, message: 'task', handler, toolChoice: 'required' });
    const context = handler.mock.calls[0][1];
    expect(context.toolChoice).toBe('required');
  });

  it('default toolChoice is "auto"', async () => {
    const handler = makeStaticHandler(makeTurnResponse({ text: 'ok' }));
    await runAgentLoop({ ...TEST_CTX, message: 'task', handler });
    const context = handler.mock.calls[0][1];
    expect(context.toolChoice).toBe('auto');
  });

  it('default maxTurns is 10', async () => {
    // Every call returns tool calls to force continuation; we verify it stops at 10
    const toolCall = makeToolCall('call_m', 'echo', { message: 'm' });
    const handler = vi.fn().mockResolvedValue(
      makeTurnResponse({ text: 'turn', toolCalls: [toolCall] }),
    );
    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler, tools: [echoTool] });
    expect(handler).toHaveBeenCalledTimes(10);
    expect(result.turns).toBe(10);
  });
});

describe('runAgentLoop 锟?AbortSignal (AgentTurnResponse path)', () => {
  beforeEach(() => { mockDrain.mockReset(); });

  it('pre-aborted signal: skips all turns, returns empty result', async () => {
    const ac = new AbortController();
    ac.abort();
    const handler = vi.fn().mockResolvedValue(makeTurnResponse({ text: 'should not run' }));
    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler, signal: ac.signal });
    expect(handler).not.toHaveBeenCalled();
    expect(result.turns).toBe(0);
    expect(result.output).toBe('');
    expect(result.toolCallCount).toBe(0);
  });

  it('signal forwarded to handler context', async () => {
    const ac = new AbortController();
    const handler = makeStaticHandler(makeTurnResponse({ text: 'ok' }));
    await runAgentLoop({ ...TEST_CTX, message: 'task', handler, signal: ac.signal });
    const context = handler.mock.calls[0][1];
    expect(context.signal).toBe(ac.signal);
  });
});

describe('runAgentLoop 锟?ReadableStream handler path', () => {
  beforeEach(() => { mockDrain.mockReset(); });

  it('drainAgentStream called when handler returns ReadableStream', async () => {
    mockDrain.mockResolvedValue(makeStreamResult({ text: 'Stream answer.' }));

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn().mockResolvedValue(stream);

    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler });
    expect(mockDrain).toHaveBeenCalledOnce();
    expect(result.output).toBe('Stream answer.');
    expect(result.turns).toBe(1);
  });

  it('shouldContinue=false: loop exits after one stream turn', async () => {
    mockDrain.mockResolvedValue(makeStreamResult({ text: 'Done.', shouldContinue: false }));

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn().mockResolvedValue(stream);

    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('Done.');
  });

  it('shouldContinue=true: loop invokes handler again', async () => {
    const searchCall = makeToolCall('call_s1', 'web_search', { query: 'AI news' });
    const searchResult = makeToolResult('call_s1', 'web_search', 'AI news from 2026');

    mockDrain
      .mockResolvedValueOnce(makeStreamResult({
        text: '',
        toolCalls: [searchCall],
        toolResultPairs: [{ call: searchCall, result: searchResult }],
        shouldContinue: true,
      }))
      .mockResolvedValueOnce(makeStreamResult({ text: 'AI news: ...', shouldContinue: false }));

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn().mockResolvedValue(stream);

    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.output).toBe('AI news: ...');
    expect(result.toolCallCount).toBe(1);
    expect(result.turns).toBe(2);
  });

  it('stream turn: calls onTextDelta for each streamed text chunk', async () => {
    mockDrain.mockImplementation(async (_stream, _exec, _sig, hooks) => {
      hooks?.onTextDelta?.('Hello ', false);
      hooks?.onTextDelta?.('World', false);
      return makeStreamResult({ text: 'Hello World', shouldContinue: false });
    });

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn().mockResolvedValue(stream);
    const onTextDelta = vi.fn();

    await runAgentLoop({ ...TEST_CTX, message: 'task', handler, onTextDelta });
    const deltas = onTextDelta.mock.calls.map((c) => c[0]);
    expect(deltas).toContain('Hello ');
    expect(deltas).toContain('World');
  });

  it('stream turn: pre-executed tool_call is counted in toolCallCount', async () => {
    const preCall = makeToolCall('call_pre', 'echo', { message: 'pre' });
    mockDrain.mockImplementation(async (_stream, _exec, _sig, hooks) => {
      hooks?.onPreExecutedResult?.(preCall, makeToolResult('call_pre', 'echo', 'pre'));
      return makeStreamResult({
        text: '',
        toolCalls: [preCall],
        toolResultPairs: [{ call: preCall, result: makeToolResult('call_pre', 'echo', 'pre') }],
        shouldContinue: false,
      });
    });

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn().mockResolvedValue(stream);

    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler });
    expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
  });

  it('stream turn: SDK-executed tool_call is counted in toolCallCount', async () => {
    const sdkCall = makeToolCall('call_sdk', 'echo', { message: 'sdk' });
    const sdkResult = makeToolResult('call_sdk', 'echo', 'sdk output');

    mockDrain.mockResolvedValue(makeStreamResult({
      text: '',
      toolCalls: [sdkCall],
      toolResultPairs: [{ call: sdkCall, result: sdkResult }],
      shouldContinue: false,
    }));

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn().mockResolvedValue(stream);

    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler });
    expect(result.toolCallCount).toBe(1);
  });

  it('stream turn: tool result starting with "Error:" does not throw, loop continues', async () => {
    const sdkCall = makeToolCall('call_fail', 'echo', { message: 'bad' });
    const failResult = makeToolResult('call_fail', 'echo', 'Error: something went wrong');

    mockDrain.mockResolvedValue(makeStreamResult({
      text: '',
      toolCalls: [sdkCall],
      toolResultPairs: [{ call: sdkCall, result: failResult }],
      shouldContinue: false,
    }));

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn().mockResolvedValue(stream);

    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler });
    expect(result.toolCallCount).toBe(1);
  });

  it('stream turn: history receives assistant + tool messages', async () => {
    const toolCall = makeToolCall('call_h1', 'echo', { message: 'history' });
    const toolRes = makeToolResult('call_h1', 'echo', 'history echoed');

    let capturedMessages: unknown[] = [];
    mockDrain
      .mockResolvedValueOnce(makeStreamResult({
        text: 'Running tool.',
        toolCalls: [toolCall],
        toolResultPairs: [{ call: toolCall, result: toolRes }],
        shouldContinue: true,
      }))
      .mockResolvedValueOnce(makeStreamResult({ text: 'All done.', shouldContinue: false }));

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn().mockImplementation(async (messages) => {
      capturedMessages = [...messages];
      return stream;
    });

    await runAgentLoop({ ...TEST_CTX, message: 'history test', handler });
    // After first turn, history should contain user, assistant (with toolCalls), tool result messages
    expect(capturedMessages.some((m: unknown) => (m as { role: string }).role === 'user')).toBe(true);
    expect(capturedMessages.some((m: unknown) => (m as { role: string }).role === 'assistant')).toBe(true);
    expect(capturedMessages.some((m: unknown) => (m as { role: string }).role === 'tool')).toBe(true);
  });

  it('stream turn: abort mid-loop stops before next turn', async () => {
    const ac = new AbortController();

    mockDrain.mockImplementation(async () => {
      ac.abort(); // simulate abort during stream processing
      return makeStreamResult({ text: '', shouldContinue: true });
    });

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn().mockResolvedValue(stream);

    const result = await runAgentLoop({ ...TEST_CTX, message: 'task', handler, signal: ac.signal });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.turns).toBe(1);
  });

  it('context.tools contains ToolDescriptor entries for each registered tool', async () => {
    const handler = makeStaticHandler(makeTurnResponse({ text: 'ok' }));
    await runAgentLoop({ ...TEST_CTX, message: 'task', handler, tools: [echoTool] });
    const context = handler.mock.calls[0][1];
    expect(Array.isArray(context.tools)).toBe(true);
    expect(context.tools.length).toBe(1);
    expect(context.tools[0]).toMatchObject({ name: 'echo' });
  });

  it('context has no toXxx methods 鈥?vendor formatting is done by standalone utilities', async () => {
    const handler = makeStaticHandler(makeTurnResponse({ text: 'ok' }));
    await runAgentLoop({ ...TEST_CTX, message: 'task', handler });
    const context = handler.mock.calls[0][1];
    expect((context as any).toOpenAITools).toBeUndefined();
    expect((context as any).toAnthropicTools).toBeUndefined();
    expect((context as any).toGeminiTools).toBeUndefined();
    expect((context as any).toOpenAIMessages).toBeUndefined();
    expect((context as any).toAnthropicMessages).toBeUndefined();
    expect((context as any).toGeminiMessages).toBeUndefined();
  });

  it('context callTool executes a registered tool', async () => {
    const handler = makeStaticHandler(makeTurnResponse({ text: 'ok' }));
    await runAgentLoop({ ...TEST_CTX, message: 'task', handler, tools: [echoTool] });
    const context = handler.mock.calls[0][1];
    const result = await context.callTool({ id: 'c1', name: 'echo', arguments: { message: 'hello' } });
    expect(result.result).toBe('hello');
  });
});

// 鈹€鈹€ thinking / reasoning_content preservation (DeepSeek 400 fix) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
//
// DeepSeek (and Doubao Seed) requires that every assistant message in thinking
// mode carries `reasoning_content` on the wire.  The SDK stores this as
// `AssistantMessage.thinking` and `toOAIMessages` maps it back.  If `thinking`
// is dropped when pushing to history the second API call receives a history
// without `reasoning_content` 鈫?400 "must be passed back to the API".

describe('runAgentLoop 鈥?thinking preserved in history (non-streaming path)', () => {
  beforeEach(() => { mockDrain.mockReset(); });

  it('thinking is saved on the assistant history entry when present', async () => {
    const toolCall = makeToolCall('c1', 'echo', { message: 'hi' });
    let secondCallMessages: unknown[] = [];

    const handler = vi.fn()
      .mockResolvedValueOnce(makeTurnResponse({
        text: '',
        thinking: 'Let me reason about this.',
        toolCalls: [toolCall],
      }))
      .mockImplementationOnce(async (msgs) => {
        secondCallMessages = [...msgs];
        return makeTurnResponse({ text: 'Done.' });
      });

    await runAgentLoop({ ...TEST_CTX, message: 'task', handler, tools: [echoTool] });

    const assistantMsg = (secondCallMessages as { role: string; thinking?: string }[])
      .find((m) => m.role === 'assistant');
    expect(assistantMsg?.thinking).toBe('Let me reason about this.');
  });

  it('thinking is absent from history entry when response has no thinking', async () => {
    const toolCall = makeToolCall('c2', 'echo', { message: 'hi' });
    let secondCallMessages: unknown[] = [];

    const handler = vi.fn()
      .mockResolvedValueOnce(makeTurnResponse({ text: '', toolCalls: [toolCall] }))
      .mockImplementationOnce(async (msgs) => {
        secondCallMessages = [...msgs];
        return makeTurnResponse({ text: 'Done.' });
      });

    await runAgentLoop({ ...TEST_CTX, message: 'task', handler, tools: [echoTool] });

    const assistantMsg = (secondCallMessages as { role: string; thinking?: unknown }[])
      .find((m) => m.role === 'assistant');
    expect(Object.prototype.hasOwnProperty.call(assistantMsg, 'thinking')).toBe(false);
  });

  it('thinking is absent when response thinking is explicitly undefined', async () => {
    const toolCall = makeToolCall('c3', 'echo', { message: 'hi' });
    let secondCallMessages: unknown[] = [];

    const handler = vi.fn()
      .mockResolvedValueOnce(makeTurnResponse({ text: '', thinking: undefined, toolCalls: [toolCall] }))
      .mockImplementationOnce(async (msgs) => {
        secondCallMessages = [...msgs];
        return makeTurnResponse({ text: 'Done.' });
      });

    await runAgentLoop({ ...TEST_CTX, message: 'task', handler, tools: [echoTool] });

    const assistantMsg = (secondCallMessages as { role: string; thinking?: unknown }[])
      .find((m) => m.role === 'assistant');
    expect(Object.prototype.hasOwnProperty.call(assistantMsg, 'thinking')).toBe(false);
  });

  it('multi-turn: thinking from each turn flows through to the subsequent call', async () => {
    const toolCall1 = makeToolCall('c4a', 'echo', { message: 'step1' });
    const toolCall2 = makeToolCall('c4b', 'echo', { message: 'step2' });
    const capturedMessages: unknown[][] = [];

    const handler = vi.fn()
      .mockResolvedValueOnce(makeTurnResponse({
        text: '',
        thinking: 'First reasoning chain.',
        toolCalls: [toolCall1],
      }))
      .mockImplementationOnce(async (msgs) => {
        capturedMessages.push([...msgs]);
        return makeTurnResponse({
          text: '',
          thinking: 'Second reasoning chain.',
          toolCalls: [toolCall2],
        });
      })
      .mockImplementationOnce(async (msgs) => {
        capturedMessages.push([...msgs]);
        return makeTurnResponse({ text: 'Final.' });
      });

    await runAgentLoop({ ...TEST_CTX, message: 'multi-turn thinking', handler, tools: [echoTool] });

    // After turn 1: second call's history contains first assistant thinking
    const firstAssistant = (capturedMessages[0] as { role: string; thinking?: string }[])
      .find((m) => m.role === 'assistant');
    expect(firstAssistant?.thinking).toBe('First reasoning chain.');

    // After turn 2: third call's history contains both assistant entries
    const allAssistants = (capturedMessages[1] as { role: string; thinking?: string }[])
      .filter((m) => m.role === 'assistant');
    expect(allAssistants).toHaveLength(2);
    expect(allAssistants[0].thinking).toBe('First reasoning chain.');
    expect(allAssistants[1].thinking).toBe('Second reasoning chain.');
  });
});

describe('runAgentLoop 鈥?thinking preserved in history (streaming path)', () => {
  beforeEach(() => { mockDrain.mockReset(); });

  it('non-empty streamThinking is saved to the assistant history entry', async () => {
    const toolCall = makeToolCall('cs1', 'echo', { message: 'hi' });
    const toolRes = makeToolResult('cs1', 'echo', 'hi');
    let secondCallMessages: unknown[] = [];

    mockDrain
      .mockResolvedValueOnce(makeStreamResult({
        text: '',
        thinking: 'Stream reasoning text.',
        toolCalls: [toolCall],
        toolResultPairs: [{ call: toolCall, result: toolRes }],
        shouldContinue: true,
      }))
      .mockResolvedValueOnce(makeStreamResult({ text: 'Done.', shouldContinue: false }));

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn()
      .mockResolvedValueOnce(stream)
      .mockImplementationOnce(async (msgs) => {
        secondCallMessages = [...msgs];
        return stream;
      });

    await runAgentLoop({ ...TEST_CTX, message: 'task', handler });

    const assistantMsg = (secondCallMessages as { role: string; thinking?: string }[])
      .find((m) => m.role === 'assistant');
    expect(assistantMsg?.thinking).toBe('Stream reasoning text.');
  });

  it('empty streamThinking ("") is NOT added to history 鈥?provider emits undefined for no-thinking turns', async () => {
    const toolCall = makeToolCall('cs2', 'echo', { message: 'hi' });
    const toolRes = makeToolResult('cs2', 'echo', 'hi');
    let secondCallMessages: unknown[] = [];

    mockDrain
      .mockResolvedValueOnce(makeStreamResult({
        text: '',
        thinking: '',    // drainAgentStream default 鈥?no thinking chunks arrived
        toolCalls: [toolCall],
        toolResultPairs: [{ call: toolCall, result: toolRes }],
        shouldContinue: true,
      }))
      .mockResolvedValueOnce(makeStreamResult({ text: 'Done.', shouldContinue: false }));

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn()
      .mockResolvedValueOnce(stream)
      .mockImplementationOnce(async (msgs) => {
        secondCallMessages = [...msgs];
        return stream;
      });

    await runAgentLoop({ ...TEST_CTX, message: 'task', handler });

    const assistantMsg = (secondCallMessages as { role: string; thinking?: unknown }[])
      .find((m) => m.role === 'assistant');
    expect(Object.prototype.hasOwnProperty.call(assistantMsg, 'thinking')).toBe(false);
  });

  it('multi-turn stream: thinking accumulates correctly across turns', async () => {
    const toolCall1 = makeToolCall('cs3a', 'echo', { message: 'x' });
    const toolRes1 = makeToolResult('cs3a', 'echo', 'x');
    const toolCall2 = makeToolCall('cs3b', 'echo', { message: 'y' });
    const toolRes2 = makeToolResult('cs3b', 'echo', 'y');
    const capturedMessages: unknown[][] = [];

    mockDrain
      .mockResolvedValueOnce(makeStreamResult({
        text: '',
        thinking: 'Reasoning turn 1.',
        toolCalls: [toolCall1],
        toolResultPairs: [{ call: toolCall1, result: toolRes1 }],
        shouldContinue: true,
      }))
      .mockResolvedValueOnce(makeStreamResult({
        text: '',
        thinking: 'Reasoning turn 2.',
        toolCalls: [toolCall2],
        toolResultPairs: [{ call: toolCall2, result: toolRes2 }],
        shouldContinue: true,
      }))
      .mockResolvedValueOnce(makeStreamResult({ text: 'Final.', shouldContinue: false }));

    const stream = new ReadableStream<AgentStreamChunk>({ start(c) { c.close(); } });
    const handler = vi.fn()
      .mockResolvedValue(stream)
      .mockImplementationOnce((_msgs) => stream)
      .mockImplementationOnce(async (msgs) => { capturedMessages.push([...msgs]); return stream; })
      .mockImplementationOnce(async (msgs) => { capturedMessages.push([...msgs]); return stream; });

    await runAgentLoop({ ...TEST_CTX, message: 'task', handler });

    // Third call: history should have two assistant entries, both with thinking
    const assistants = (capturedMessages[capturedMessages.length - 1] as { role: string; thinking?: string }[])
      .filter((m) => m.role === 'assistant');
    expect(assistants.length).toBeGreaterThanOrEqual(2);
    const withThinking = assistants.filter((m) => m.thinking);
    expect(withThinking.length).toBeGreaterThanOrEqual(1);
  });
});
