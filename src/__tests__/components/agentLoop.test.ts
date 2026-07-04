import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drainAgentStream } from '../../tools/agentLoop';
import type { AgentStreamChunk, ToolCall, ToolResult } from '@agent-type';
import type { AgentStreamHooks } from '../../tools/agentLoop';

// ── Stream helper ─────────────────────────────────────────────────────────────

function makeStream(chunks: AgentStreamChunk[]): ReadableStream<AgentStreamChunk> {
  let i = 0;
  return new ReadableStream<AgentStreamChunk>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

// ── Realistic fixture data ────────────────────────────────────────────────────

const searchCall: ToolCall = {
  id: 'call_abc123',
  name: 'web_search',
  arguments: { query: 'TypeScript 5.5 release notes' },
};

const searchResult: ToolResult = {
  toolCallId: 'call_abc123',
  name: 'web_search',
  result: 'TypeScript 5.5 was released June 2024 with improved type narrowing...',
};

const codeCall: ToolCall = {
  id: 'call_def456',
  name: 'execute_code',
  arguments: { language: 'typescript', code: 'console.log("hello world")' },
};

const codeResult: ToolResult = {
  toolCallId: 'call_def456',
  name: 'execute_code',
  result: 'hello world',
};

const databaseCall: ToolCall = {
  id: 'call_ghi789',
  name: 'query_database',
  arguments: { sql: 'SELECT COUNT(*) FROM users WHERE active = 1' },
};

const databaseResult: ToolResult = {
  toolCallId: 'call_ghi789',
  name: 'query_database',
  result: '{ "count": 1247 }',
};

const TEST_SIGNAL = new AbortController().signal;

// ── Basic text stream tests ───────────────────────────────────────────────────

describe('drainAgentStream — text chunks', () => {
  it('returns empty text for empty stream', async () => {
    const result = await drainAgentStream(makeStream([]), async () => searchResult, TEST_SIGNAL);
    expect(result.text).toBe('');
    expect(result.thinking).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.toolResultPairs).toEqual([]);
    expect(result.attachments).toEqual([]);
    expect(result.usage).toBeUndefined();
    expect(result.shouldContinue).toBe(false);
  });

  it('accumulates multiple text deltas into a single string', async () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: 'Here is a summary of ' },
      { type: 'text', delta: 'TypeScript 5.5: ' },
      { type: 'text', delta: 'major improvements in type narrowing.' },
    ];
    const result = await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL);
    expect(result.text).toBe('Here is a summary of TypeScript 5.5: major improvements in type narrowing.');
    expect(result.shouldContinue).toBe(false);
  });

  it('text-only stream: shouldContinue is false', async () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: 'The answer is 42.' },
    ];
    const result = await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL);
    expect(result.shouldContinue).toBe(false);
  });

  it('calls onTextDelta for each chunk with correct hasSeenTool=false', async () => {
    const onTextDelta = vi.fn();
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: 'First part. ' },
      { type: 'text', delta: 'Second part.' },
    ];
    await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL, { onTextDelta });
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'First part. ', false);
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'Second part.', false);
  });
});

// ── Thinking chunks ───────────────────────────────────────────────────────────

describe('drainAgentStream — thinking chunks', () => {
  it('accumulates thinking deltas', async () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'thinking', delta: 'Let me consider the problem... ' },
      { type: 'thinking', delta: 'The user wants to search for TypeScript docs.' },
    ];
    const result = await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL);
    expect(result.thinking).toBe('Let me consider the problem... The user wants to search for TypeScript docs.');
    expect(result.text).toBe('');
    expect(result.shouldContinue).toBe(false);
  });

  it('calls onThinkingDelta with correct hasSeenTool=false before any tool', async () => {
    const onThinkingDelta = vi.fn();
    const chunks: AgentStreamChunk[] = [
      { type: 'thinking', delta: 'I need to think about this...' },
    ];
    await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL, { onThinkingDelta });
    expect(onThinkingDelta).toHaveBeenCalledOnce();
    expect(onThinkingDelta).toHaveBeenCalledWith('I need to think about this...', false);
  });

  it('thinking + text: separate fields, no tool calls', async () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'thinking', delta: 'Reasoning: the answer is clear.' },
      { type: 'text', delta: 'The answer is 42.' },
    ];
    const result = await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL);
    expect(result.thinking).toBe('Reasoning: the answer is clear.');
    expect(result.text).toBe('The answer is 42.');
  });
});

// ── Single tool_call ──────────────────────────────────────────────────────────

describe('drainAgentStream — single tool_call', () => {
  it('executes the tool and returns result in toolResultPairs', async () => {
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(executeTool).toHaveBeenCalledOnce();
    expect(executeTool).toHaveBeenCalledWith(searchCall);
    expect(result.toolCalls).toEqual([searchCall]);
    expect(result.toolResultPairs).toEqual([{ call: searchCall, result: searchResult }]);
    expect(result.shouldContinue).toBe(true);
  });

  it('shouldContinue=true when tool_call with no post-tool text', async () => {
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.shouldContinue).toBe(true);
  });

  it('shouldContinue=false when tool_call followed by post-tool text', async () => {
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
      { type: 'text', delta: 'Based on the search results, I found the following...' },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.shouldContinue).toBe(false);
    expect(result.text).toBe('Based on the search results, I found the following...');
  });

  it('calls onFirstToolSeen exactly once', async () => {
    const onFirstToolSeen = vi.fn();
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
    ];
    await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, { onFirstToolSeen });
    expect(onFirstToolSeen).toHaveBeenCalledOnce();
  });

  it('pre-tool text arrives with hasSeenTool=false, post-tool text with hasSeenTool=true', async () => {
    const onTextDelta = vi.fn();
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: 'Let me search for that. ' },
      { type: 'tool_call', call: searchCall },
      { type: 'text', delta: 'Here is what I found.' },
    ];
    await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, { onTextDelta });
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Let me search for that. ', false);
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'Here is what I found.', true);
  });
});

// ── Multiple parallel tool_calls ──────────────────────────────────────────────

describe('drainAgentStream — multiple parallel tool_calls', () => {
  it('executes all tools in parallel and collects all results', async () => {
    const executeTool = vi.fn()
      .mockImplementation(async (call: ToolCall) => {
        if (call.id === 'call_abc123') return searchResult;
        if (call.id === 'call_def456') return codeResult;
        if (call.id === 'call_ghi789') return databaseResult;
        throw new Error('unknown call');
      });

    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
      { type: 'tool_call', call: codeCall },
      { type: 'tool_call', call: databaseCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(result.toolCalls).toEqual([searchCall, codeCall, databaseCall]);
    expect(result.toolResultPairs).toHaveLength(3);
    expect(result.toolResultPairs.map(p => p.call)).toEqual([searchCall, codeCall, databaseCall]);
    expect(result.shouldContinue).toBe(true);
  });

  it('calls onFirstToolSeen only once across multiple tool_calls', async () => {
    const onFirstToolSeen = vi.fn();
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
      { type: 'tool_call', call: codeCall },
      { type: 'tool_call', call: databaseCall },
    ];
    await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, { onFirstToolSeen });
    expect(onFirstToolSeen).toHaveBeenCalledOnce();
  });

  it('multiple tools + text before any tool: pre-tool text uses hasSeenTool=false', async () => {
    const onTextDelta = vi.fn();
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: "I'll search and run code simultaneously." },
      { type: 'tool_call', call: searchCall },
      { type: 'tool_call', call: codeCall },
    ];
    await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, { onTextDelta });
    expect(onTextDelta).toHaveBeenCalledOnce();
    expect(onTextDelta).toHaveBeenCalledWith("I'll search and run code simultaneously.", false);
  });
});

// ── tool_result (pre-executed) chunks ─────────────────────────────────────────

describe('drainAgentStream — pre-executed tool_result chunks', () => {
  it('tool_result chunks are in toolResultPairs, no executeTool called', async () => {
    const executeTool = vi.fn();
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_result', call: searchCall, result: searchResult },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([searchCall]);
    expect(result.toolResultPairs).toEqual([{ call: searchCall, result: searchResult }]);
  });

  it('tool_result: shouldContinue=false (no SDK-executed tool_call)', async () => {
    const executeTool = vi.fn();
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_result', call: searchCall, result: searchResult },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.shouldContinue).toBe(false);
  });

  it('tool_result: calls onFirstToolSeen once and onPreExecutedResult', async () => {
    const onFirstToolSeen = vi.fn();
    const onPreExecutedResult = vi.fn();
    const executeTool = vi.fn();
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_result', call: searchCall, result: searchResult },
      { type: 'tool_result', call: codeCall, result: codeResult },
    ];
    await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, { onFirstToolSeen, onPreExecutedResult });
    expect(onFirstToolSeen).toHaveBeenCalledOnce();
    expect(onPreExecutedResult).toHaveBeenCalledTimes(2);
    expect(onPreExecutedResult).toHaveBeenNthCalledWith(1, searchCall, searchResult);
    expect(onPreExecutedResult).toHaveBeenNthCalledWith(2, codeCall, codeResult);
  });

  it('pre-executed pairs come after SDK pairs in toolResultPairs', async () => {
    const executeTool = vi.fn().mockResolvedValue(codeResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: codeCall },
      { type: 'tool_result', call: searchCall, result: searchResult },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.toolResultPairs[0]).toEqual({ call: codeCall, result: codeResult });
    expect(result.toolResultPairs[1]).toEqual({ call: searchCall, result: searchResult });
  });
});

// ── Usage chunk ───────────────────────────────────────────────────────────────

describe('drainAgentStream — usage chunk', () => {
  it('captures usage from a usage chunk', async () => {
    const usage = { promptTokens: 512, completionTokens: 128, totalTokens: 640 };
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: 'Here is a concise answer.' },
      { type: 'usage', usage },
    ];
    const result = await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL);
    expect(result.usage).toEqual(usage);
  });

  it('usage is undefined when no usage chunk', async () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: 'No usage reported here.' },
    ];
    const result = await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL);
    expect(result.usage).toBeUndefined();
  });

  it('last usage chunk wins if multiple usage chunks arrive', async () => {
    const usage1 = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    const usage2 = { promptTokens: 200, completionTokens: 100, totalTokens: 300 };
    const chunks: AgentStreamChunk[] = [
      { type: 'usage', usage: usage1 },
      { type: 'text', delta: 'Some text.' },
      { type: 'usage', usage: usage2 },
    ];
    const result = await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL);
    expect(result.usage).toEqual(usage2);
  });
});

// ── Attachment chunks ─────────────────────────────────────────────────────────

describe('drainAgentStream — attachment chunks', () => {
  it('captures attachment in attachments array', async () => {
    const attachment = {
      source: 'data' as const,
      kind: 'image' as const,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      mimeType: 'image/png',
      name: 'generated_chart.png',
    };
    const chunks: AgentStreamChunk[] = [
      { type: 'attachment', attachment },
    ];
    const result = await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual(attachment);
  });

  it('calls onAttachment hook for each attachment', async () => {
    const onAttachment = vi.fn();
    const attachment1 = {
      source: 'data' as const,
      kind: 'image' as const,
      data: 'abc',
      mimeType: 'image/png',
      name: 'chart1.png',
    };
    const attachment2 = {
      source: 'data' as const,
      kind: 'image' as const,
      data: 'def',
      mimeType: 'image/jpeg',
      name: 'chart2.jpg',
    };
    const chunks: AgentStreamChunk[] = [
      { type: 'attachment', attachment: attachment1 },
      { type: 'attachment', attachment: attachment2 },
    ];
    await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL, { onAttachment });
    expect(onAttachment).toHaveBeenCalledTimes(2);
    expect(onAttachment).toHaveBeenNthCalledWith(1, attachment1);
    expect(onAttachment).toHaveBeenNthCalledWith(2, attachment2);
  });

  it('multiple attachments all captured', async () => {
    const att = (name: string) => ({
      source: 'data' as const,
      kind: 'image' as const,
      data: name,
      mimeType: 'image/png',
      name,
    });
    const chunks: AgentStreamChunk[] = [
      { type: 'attachment', attachment: att('a.png') },
      { type: 'attachment', attachment: att('b.png') },
      { type: 'attachment', attachment: att('c.png') },
    ];
    const result = await drainAgentStream(makeStream(chunks), async () => searchResult, TEST_SIGNAL);
    expect(result.attachments).toHaveLength(3);
  });
});

// ── Error isolation ───────────────────────────────────────────────────────────

describe('drainAgentStream — executeTool error isolation', () => {
  it('converts Error rejection to structured error result', async () => {
    const executeTool = vi.fn().mockRejectedValue(new Error('network timeout'));
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.toolResultPairs).toHaveLength(1);
    expect(result.toolResultPairs[0].call).toEqual(searchCall);
    expect(result.toolResultPairs[0].result.toolCallId).toBe('call_abc123');
    expect(result.toolResultPairs[0].result.name).toBe('web_search');
    expect(result.toolResultPairs[0].result.result).toBe('Error: network timeout');
  });

  it('converts non-Error rejection (string) to structured error result', async () => {
    const executeTool = vi.fn().mockRejectedValue('Service unavailable');
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.toolResultPairs[0].result.result).toBe('Error: Service unavailable');
  });

  it('one tool fails, others succeed: all results collected', async () => {
    const executeTool = vi.fn().mockImplementation(async (call: ToolCall) => {
      if (call.id === 'call_abc123') throw new Error('quota exceeded');
      if (call.id === 'call_def456') return codeResult;
      return databaseResult;
    });
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
      { type: 'tool_call', call: codeCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.toolResultPairs).toHaveLength(2);
    expect(result.toolResultPairs[0].result.result).toBe('Error: quota exceeded');
    expect(result.toolResultPairs[1].result.result).toBe('hello world');
  });
});

// ── AbortSignal ───────────────────────────────────────────────────────────────

describe('drainAgentStream — AbortSignal', () => {
  it('aborts during stream: breaks out of read loop, then throws AbortError (no pending tools)', async () => {
    const ac = new AbortController();
    let pullCount = 0;

    // Stream that aborts itself on the first pull — no tool_call chunks so
    // pending[] is empty, but signal.aborted=true → post-loop throws AbortError.
    const stream = new ReadableStream<AgentStreamChunk>({
      pull(controller) {
        pullCount++;
        if (pullCount === 1) {
          controller.enqueue({ type: 'text', delta: 'Hello' });
          ac.abort();
        } else {
          controller.enqueue({ type: 'text', delta: ' World' });
          controller.close();
        }
      },
    });

    const executeTool = vi.fn();
    // After the stream loop exits (signal.aborted), the function hits
    // `else if (signal?.aborted) { throw new DOMException(...) }`.
    await expect(
      drainAgentStream(stream, executeTool, ac.signal),
    ).rejects.toThrow('Aborted');
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('signal already aborted before result collection: throws DOMException AbortError', async () => {
    const ac = new AbortController();
    // Abort before calling drainAgentStream
    ac.abort();

    // A tool call that takes a while
    const executeTool = vi.fn().mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve(searchResult), 100);
    }));

    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
    ];

    // The stream read will break immediately (signal.aborted=true), then
    // after the loop we check signal?.aborted → throws AbortError
    await expect(
      drainAgentStream(makeStream(chunks), executeTool, ac.signal),
    ).rejects.toThrow('Aborted');
  });

  it('signal aborted during result collection: Promise.race throws AbortError', async () => {
    const ac = new AbortController();

    // Tool that takes long enough to trigger the race
    const executeTool = vi.fn().mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve(searchResult), 50);
    }));

    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
    ];

    // Abort after stream is done but while tools are still pending
    // Stream drains immediately; tools take 50ms
    setTimeout(() => ac.abort(), 10);

    await expect(
      drainAgentStream(makeStream(chunks), executeTool, ac.signal),
    ).rejects.toThrow('Aborted');
  });

  it('runs to completion normally with TEST_SIGNAL', async () => {
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: 'Processing your request.' },
      { type: 'tool_call', call: searchCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.text).toBe('Processing your request.');
    expect(result.toolResultPairs).toHaveLength(1);
    expect(result.shouldContinue).toBe(true);
  });

  it('no hooks (undefined): runs without error', async () => {
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: 'Hello.' },
      { type: 'tool_call', call: searchCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, undefined);
    expect(result.text).toBe('Hello.');
    expect(result.toolResultPairs).toHaveLength(1);
  });
});

// ── Complex realistic mixed streams ──────────────────────────────────────────

describe('drainAgentStream — realistic mixed streams', () => {
  it('full research flow: thinking → text → search tool → code tool → post-text', async () => {
    const executeTool = vi.fn().mockImplementation(async (call: ToolCall) => {
      if (call.id === 'call_abc123') return searchResult;
      return codeResult;
    });
    const hooks: AgentStreamHooks = {
      onTextDelta: vi.fn(),
      onThinkingDelta: vi.fn(),
      onFirstToolSeen: vi.fn(),
      onPreExecutedResult: vi.fn(),
      onAttachment: vi.fn(),
    };

    const chunks: AgentStreamChunk[] = [
      { type: 'thinking', delta: "Let me search for TypeScript 5.5 release notes first, then run a code example." },
      { type: 'text', delta: "I'll research TypeScript 5.5 and run a demo. " },
      { type: 'tool_call', call: searchCall },
      { type: 'tool_call', call: codeCall },
      { type: 'text', delta: 'Based on the results, here is what I found.' },
      { type: 'usage', usage: { promptTokens: 1024, completionTokens: 256, totalTokens: 1280 } },
    ];

    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, hooks);

    expect(result.thinking).toBe("Let me search for TypeScript 5.5 release notes first, then run a code example.");
    expect(result.text).toBe("I'll research TypeScript 5.5 and run a demo. Based on the results, here is what I found.");
    expect(result.toolCalls).toEqual([searchCall, codeCall]);
    expect(result.toolResultPairs).toHaveLength(2);
    expect(result.usage).toEqual({ promptTokens: 1024, completionTokens: 256, totalTokens: 1280 });
    // post-tool text → shouldContinue = false
    expect(result.shouldContinue).toBe(false);

    expect(hooks.onThinkingDelta).toHaveBeenCalledOnce();
    expect(hooks.onFirstToolSeen).toHaveBeenCalledOnce();
    // pre-tool text (hasSeenTool=false), post-tool text (hasSeenTool=true)
    expect(hooks.onTextDelta).toHaveBeenNthCalledWith(1, "I'll research TypeScript 5.5 and run a demo. ", false);
    expect(hooks.onTextDelta).toHaveBeenNthCalledWith(2, 'Based on the results, here is what I found.', true);
  });

  it('pure multi-tool no text: shouldContinue=true, no post-tool text', async () => {
    const executeTool = vi.fn().mockImplementation(async (call: ToolCall) => {
      if (call.id === 'call_abc123') return searchResult;
      if (call.id === 'call_def456') return codeResult;
      return databaseResult;
    });
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
      { type: 'tool_call', call: codeCall },
      { type: 'tool_call', call: databaseCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.shouldContinue).toBe(true);
    expect(result.text).toBe('');
    expect(result.toolResultPairs).toHaveLength(3);
  });

  it('mix of pre-executed and SDK-executed tools in same stream', async () => {
    const executeTool = vi.fn().mockResolvedValue(codeResult);
    const onPreExecutedResult = vi.fn();
    const chunks: AgentStreamChunk[] = [
      // Handler already ran the DB query
      { type: 'tool_result', call: databaseCall, result: databaseResult },
      // SDK should run the code tool
      { type: 'tool_call', call: codeCall },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, { onPreExecutedResult });

    expect(executeTool).toHaveBeenCalledOnce();
    expect(executeTool).toHaveBeenCalledWith(codeCall);
    expect(onPreExecutedResult).toHaveBeenCalledWith(databaseCall, databaseResult);
    // SDK pairs first, then pre-executed
    expect(result.toolResultPairs[0]).toEqual({ call: codeCall, result: codeResult });
    expect(result.toolResultPairs[1]).toEqual({ call: databaseCall, result: databaseResult });
    // sdkExecutedAnyTool=true (codeCall was SDK-executed)
    expect(result.shouldContinue).toBe(true);
  });

  it('thinking + multiple tool calls + usage but no text', async () => {
    const executeTool = vi.fn().mockImplementation(async (call: ToolCall) => {
      if (call.id === 'call_abc123') return searchResult;
      return databaseResult;
    });
    const usage = { promptTokens: 800, completionTokens: 0, totalTokens: 800 };
    const chunks: AgentStreamChunk[] = [
      { type: 'thinking', delta: 'I need to run two tools simultaneously.' },
      { type: 'tool_call', call: searchCall },
      { type: 'tool_call', call: databaseCall },
      { type: 'usage', usage },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.thinking).toBe('I need to run two tools simultaneously.');
    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([searchCall, databaseCall]);
    expect(result.usage).toEqual(usage);
    expect(result.shouldContinue).toBe(true);
  });

  it('attachment after tool_call: attachment captured, shouldContinue based on tool', async () => {
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const attachment = {
      source: 'data' as const,
      kind: 'image' as const,
      data: 'abc123',
      mimeType: 'image/png',
      name: 'result_chart.png',
    };
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
      { type: 'attachment', attachment },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual(attachment);
    expect(result.shouldContinue).toBe(true);
  });
});

// ── Hooks partial/optional variants ──────────────────────────────────────────

describe('drainAgentStream — partial hooks (only some callbacks provided)', () => {
  it('only onTextDelta provided: no crash on tool_call/attachment/thinking', async () => {
    const onTextDelta = vi.fn();
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'thinking', delta: 'reasoning' },
      { type: 'text', delta: 'Hello ' },
      { type: 'tool_call', call: searchCall },
      { type: 'text', delta: 'done.' },
    ];
    const result = await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, { onTextDelta });
    expect(result.text).toBe('Hello done.');
    expect(onTextDelta).toHaveBeenCalledTimes(2);
  });

  it('only onFirstToolSeen provided: called for tool_result too', async () => {
    const onFirstToolSeen = vi.fn();
    const executeTool = vi.fn();
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_result', call: searchCall, result: searchResult },
    ];
    await drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, { onFirstToolSeen });
    expect(onFirstToolSeen).toHaveBeenCalledOnce();
  });

  it('empty hooks object: no crash', async () => {
    const executeTool = vi.fn().mockResolvedValue(searchResult);
    const chunks: AgentStreamChunk[] = [
      { type: 'tool_call', call: searchCall },
    ];
    await expect(
      drainAgentStream(makeStream(chunks), executeTool, TEST_SIGNAL, {}),
    ).resolves.toBeDefined();
  });

  it('unknown chunk type: silently ignored, no crash', async () => {
    // Covers the implicit else branch after all known else-if arms
    const unknownChunk = { type: 'future_vendor_extension', data: 'ignored' } as unknown as AgentStreamChunk;
    const result = await drainAgentStream(makeStream([unknownChunk]), async () => searchResult, TEST_SIGNAL);
    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.shouldContinue).toBe(false);
  });
});

// ── reader.cancel() rejection (catch handler coverage) ───────────────────────

describe('drainAgentStream — reader.cancel() rejection in onAbort handler', () => {
  it('abort with stream cancel() rejecting: catch handler swallows the error', async () => {
    const ac = new AbortController();
    // This stream's cancel method rejects — the `.catch(() => {})` in onAbort must swallow it
    const stream = new ReadableStream<AgentStreamChunk>({
      start(controller) {
        controller.enqueue({ type: 'text', delta: 'partial' });
        // Leave the stream open so the abort cancels it
      },
      cancel(): Promise<void> {
        return Promise.reject(new Error('stream cancel failed'));
      },
    });

    // Abort immediately
    ac.abort();

    // Should throw AbortError (signal already aborted before result collection),
    // but the reader.cancel() rejection must NOT propagate — it is swallowed by catch(()=>{})
    await expect(
      drainAgentStream(stream, async () => searchResult, ac.signal),
    ).rejects.toThrow('Aborted');
  });

  it('abort while stream is actively reading: onAbort fires, reader.cancel() rejection swallowed', async () => {
    const ac = new AbortController();
    // Stream never closes — leaves reader.read() hanging until abort fires
    const stream = new ReadableStream<AgentStreamChunk>({
      start(_controller) {
        // produce nothing — read() will pend
      },
      cancel(): Promise<void> {
        // Reject to force the .catch(()=>{}) handler to execute
        return Promise.reject(new Error('forced cancel failure'));
      },
    });

    // Abort after a short delay while read() is pending
    setTimeout(() => ac.abort(), 5);

    // The abort fires → onAbort → reader.cancel() rejects → .catch(()=>{}) swallows it
    // Then signal.aborted=true after the loop → throws AbortError
    await expect(
      drainAgentStream(stream, async () => searchResult, ac.signal),
    ).rejects.toThrow('Aborted');
  });
});
