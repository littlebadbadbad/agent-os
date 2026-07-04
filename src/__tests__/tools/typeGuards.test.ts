import { describe, it, expect } from 'vitest';
import { isAgentTurnResponse, isAgentStreamChunk } from '../../tools/types/response';
// Import from the barrel to ensure the re-export index is covered
import { isAgentTurnResponse as _iATR, isAgentStreamChunk as _iASC } from '../../tools/types';

// ── isAgentTurnResponse ───────────────────────────────────────────────────────

describe('isAgentTurnResponse', () => {
  it('returns true for an object with a text property', () => {
    expect(isAgentTurnResponse({ text: 'hello' })).toBe(true);
  });

  it('returns true for a full AgentTurnResponse', () => {
    expect(isAgentTurnResponse({
      text: 'Done',
      thinking: 'Step by step',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isAgentTurnResponse(null)).toBe(false);
  });

  it('returns false for a primitive', () => {
    expect(isAgentTurnResponse('text')).toBe(false);
    expect(isAgentTurnResponse(42)).toBe(false);
    expect(isAgentTurnResponse(undefined)).toBe(false);
  });

  it('returns false for an object without text property', () => {
    expect(isAgentTurnResponse({ role: 'assistant', content: 'hi' })).toBe(false);
  });

  it('returns false for an object with both text and delta (stream chunk)', () => {
    // If 'delta' is present, it is a stream chunk, not a turn response
    expect(isAgentTurnResponse({ text: 'hi', delta: 'hi' })).toBe(false);
  });

  it('returns false for a ReadableStream-like object', () => {
    const stream = { getReader: () => ({}) };
    expect(isAgentTurnResponse(stream)).toBe(false);
  });
});

// ── isAgentStreamChunk ────────────────────────────────────────────────────────

describe('isAgentStreamChunk', () => {
  it('returns true for a text chunk', () => {
    expect(isAgentStreamChunk({ type: 'text', delta: 'hello' })).toBe(true);
  });

  it('returns true for a thinking chunk', () => {
    expect(isAgentStreamChunk({ type: 'thinking', delta: 'reasoning...' })).toBe(true);
  });

  it('returns true for a tool_call chunk', () => {
    expect(isAgentStreamChunk({ type: 'tool_call', call: { id: 'c1', name: 'f', arguments: {} } })).toBe(true);
  });

  it('returns true for a tool_result chunk', () => {
    expect(isAgentStreamChunk({
      type: 'tool_result',
      call: { id: 'c1', name: 'f', arguments: {} },
      result: { toolCallId: 'c1', name: 'f', result: 'ok' },
    })).toBe(true);
  });

  it('returns true for an attachment chunk', () => {
    expect(isAgentStreamChunk({
      type: 'attachment',
      attachment: { source: 'url', url: 'https://example.com/img.png' },
    })).toBe(true);
  });

  it('returns true for a usage chunk', () => {
    expect(isAgentStreamChunk({
      type: 'usage',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })).toBe(true);
  });

  it('returns false for an unknown type string', () => {
    expect(isAgentStreamChunk({ type: 'unknown_type' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAgentStreamChunk(null)).toBe(false);
  });

  it('returns false for a primitive', () => {
    expect(isAgentStreamChunk('text')).toBe(false);
    expect(isAgentStreamChunk(42)).toBe(false);
  });

  it('returns false for an object without type', () => {
    expect(isAgentStreamChunk({ delta: 'hi' })).toBe(false);
  });
});
