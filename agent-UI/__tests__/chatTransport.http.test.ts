/**
 * Tests for agent-UI/transport/chatTransport.ts — HTTP (standalone) path
 *
 * Mocks global.fetch to simulate SSE responses from the backend.
 * Verifies that `sendStream` correctly strips `data:` SSE prefixes,
 * parses all chunk types, handles [DONE] sentinel, and surfaces errors.
 *
 * This is the core regression test for the SSE `data:` prefix bug:
 *   backend  →  `data: {"type":"text","delta":"..."}\n\n`
 *   frontend →  must strip `data: ` before JSON.parse
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentStreamChunk } from '@agent-sdk';

// ── Module-level mocks (hoisted by vitest) ────────────────────────────────────

vi.mock('../env', () => ({ IS_ELECTRON_IPC: false }));
vi.mock('../config', () => ({ BACKEND_URL: '' }));

import { chatTransport } from '../transport/chatTransport';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build an SSE-format ReadableStream<Uint8Array> from an array of text lines.
 * Each line is treated as an SSE `data:` event (with trailing \n\n delimiters
 * simulated by joining with \n\n).
 */
function makeSseBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Simulate receiving the SSE payload as one chunk
      controller.enqueue(encoder.encode(lines.join('\n\n')));
      controller.close();
    },
  });
}

function mockFetchOk(body: ReadableStream<Uint8Array>): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    body,
    text: vi.fn(),
  } as unknown as Response);
}

function mockFetchError(status: number, statusText: string): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    text: vi.fn().mockResolvedValue(statusText),
  } as unknown as Response);
}

/** Drain a ReadableStream<AgentStreamChunk> into an array. */
async function collectStream(
  stream: ReadableStream<AgentStreamChunk>,
): Promise<AgentStreamChunk[]> {
  const reader = stream.getReader();
  const chunks: AgentStreamChunk[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

const DEFAULT_PARAMS = {
  provider: 'doubao',
  model: 'doubao-seed-123',
  messages: [{ role: 'user' as const, content: 'Hi' }],
};

// ═════════════════════════════════════════════════════════════════════════════
// sendAsync (non-streaming)
// ═════════════════════════════════════════════════════════════════════════════

describe('sendAsync (HTTP)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /api/chat and returns JSON', async () => {
    const response = { text: 'Hello!', toolCalls: [] };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    } as unknown as Response);

    const result = await chatTransport.sendAsync(DEFAULT_PARAMS);
    expect(result).toEqual(response);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: vi.fn().mockResolvedValue('Upstream timeout'),
    } as unknown as Response);

    await expect(chatTransport.sendAsync(DEFAULT_PARAMS)).rejects.toThrow(/502/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendStream — SSE parsing
// ═════════════════════════════════════════════════════════════════════════════

describe('sendStream (HTTP) — SSE parsing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses text chunks from SSE data: events', async () => {
    mockFetchOk(makeSseBody([
      'data: {"type":"text","delta":"Hello"}',
      'data: {"type":"text","delta":" world"}',
      'data: [DONE]',
    ]));

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const chunks = await collectStream(stream);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'text', delta: ' world' });
  });

  it('parses thinking chunks', async () => {
    mockFetchOk(makeSseBody([
      'data: {"type":"thinking","delta":"reasoning step 1"}',
      'data: {"type":"text","delta":"Answer: 42"}',
      'data: [DONE]',
    ]));

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const chunks = await collectStream(stream);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'thinking', delta: 'reasoning step 1' });
    expect(chunks[1]).toEqual({ type: 'text', delta: 'Answer: 42' });
  });

  it('parses tool_call chunks', async () => {
    const toolCall = { id: 'tc1', name: 'add', arguments: { a: 1, b: 2 } };
    mockFetchOk(makeSseBody([
      'data: {"type":"tool_call","call":{"id":"tc1","name":"add","arguments":{"a":1,"b":2}}}',
      'data: [DONE]',
    ]));

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const chunks = await collectStream(stream);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'tool_call', call: toolCall });
  });

  it('parses usage chunks', async () => {
    const usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
    mockFetchOk(makeSseBody([
      'data: {"type":"usage","usage":{"promptTokens":10,"completionTokens":20,"totalTokens":30}}',
      'data: [DONE]',
    ]));

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const chunks = await collectStream(stream);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'usage', usage });
  });

  it('handles a mix of all chunk types in one stream', async () => {
    mockFetchOk(makeSseBody([
      'data: {"type":"thinking","delta":"Hmm"}',
      'data: {"type":"text","delta":"The result is "}',
      'data: {"type":"text","delta":"42"}',
      'data: [DONE]',
    ]));

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const chunks = await collectStream(stream);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'thinking', delta: 'Hmm' });
    expect(chunks[1]).toEqual({ type: 'text', delta: 'The result is ' });
    expect(chunks[2]).toEqual({ type: 'text', delta: '42' });
  });

  it('skips malformed JSON lines gracefully', async () => {
    mockFetchOk(makeSseBody([
      'data: {"type":"text","delta":"valid"}',
      'data: {invalid json}',
      'data: {"type":"text","delta":"also valid"}',
      'data: [DONE]',
    ]));

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const chunks = await collectStream(stream);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', delta: 'valid' });
    expect(chunks[1]).toEqual({ type: 'text', delta: 'also valid' });
  });

  it('handles empty lines between SSE events', async () => {
    mockFetchOk(makeSseBody([
      'data: {"type":"text","delta":"Hello"}',
      '',
      'data: {"type":"text","delta":" world"}',
      'data: [DONE]',
    ]));

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const chunks = await collectStream(stream);

    expect(chunks).toHaveLength(2);
  });

  it('throws on HTTP error status', async () => {
    mockFetchError(502, 'Upstream failed');

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await expect(collectStream(stream)).rejects.toThrow(/502/);
  });

  it('throws when response body is null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    } as unknown as Response);

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await expect(collectStream(stream)).rejects.toThrow('No response body');
  });

  it('closes the stream immediately when the response has no data events', async () => {
    mockFetchOk(makeSseBody(['data: [DONE]']));

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const chunks = await collectStream(stream);

    expect(chunks).toHaveLength(0);
  });

  it('sends the correct request body to /api/chat/stream', async () => {
    mockFetchOk(makeSseBody(['data: [DONE]']));

    const stream = chatTransport.sendStream({
      provider: 'qwen',
      model: 'qwen-max',
      messages: [{ role: 'user', content: 'test' }],
      tools: [{ name: 'add', description: 'Add numbers', parameters: {} }],
      toolChoice: 'auto',
      systemPrompt: 'Be concise',
    });

    await collectStream(stream);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/chat/stream',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const callArgs = (globalThis.fetch as any).mock.calls[0][1];
    const body = JSON.parse(callArgs.body);
    expect(body.provider).toBe('qwen');
    expect(body.model).toBe('qwen-max');
    expect(body.messages).toHaveLength(1);
    expect(body.tools).toHaveLength(1);
    expect(body.toolChoice).toBe('auto');
    expect(body.systemPrompt).toBe('Be concise');
  });
});
