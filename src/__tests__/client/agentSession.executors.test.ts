/**
 * Unit tests for agentSession.executors.ts — the tool call executor builder.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildRunToolCall } from '../../client/agentSession.executors';
import type { ToolCall, ToolResult } from '@agent-type';
import type { Message } from '@agent-sdk/utils/shared';

function makeMessages(): Message[] {
  return [];
}

describe('buildRunToolCall', () => {
  it('returns a function that executes the tool and updates UI state', async () => {
    let state: Message[] = [];
    const setMessages = vi.fn((fn: (prev: Message[]) => Message[]) => {
      state = fn(state);
    });
    const callTool = vi.fn(async (_call: ToolCall, _signal: AbortSignal): Promise<ToolResult> => ({
      toolCallId: 'tc-1',
      name: 'echo',
      result: 'hello world',
    }));
    const getSignal = vi.fn(() => new AbortController().signal);

    const runToolCall = buildRunToolCall(setMessages, callTool, getSignal);
    const result = await runToolCall({ id: 'tc-1', name: 'echo', arguments: {} });

    expect(result.result).toBe('hello world');
    expect(setMessages).toHaveBeenCalledTimes(2);
    // State should have the update with done status
    const tcMsg = state.find((m: Message) => m.id === 'tc-1');
    expect(tcMsg?.toolCall?.status).toBe('done');
  });

  it('handles tool execution error and returns structured error result', async () => {
    let state: Message[] = [{ id: 'other', role: 'user', content: 'other', isStreaming: false }];
    const setMessages = vi.fn((fn: (prev: Message[]) => Message[]) => {
      state = fn(state);
    });
    const callTool = vi.fn(async () => { throw new Error('Something broke'); });
    const getSignal = vi.fn(() => new AbortController().signal);

    const runToolCall = buildRunToolCall(setMessages, callTool, getSignal);
    const result = await runToolCall({ id: 'tc-2', name: 'fail', arguments: {} });

    expect(result.result).toContain('Error');
    expect(result.result).toContain('Something broke');
    expect(setMessages).toHaveBeenCalledTimes(2);
    // State should have the update with error status
    const tcMsg = state.find((m: Message) => m.id === 'tc-2');
    expect(tcMsg?.toolCall?.status).toBe('error');
  });

  it('updates tool message with attachments when present', async () => {
    let state: Message[] = [];
    const setMessages = vi.fn((fn: (prev: Message[]) => Message[]) => {
      state = fn(state);
    });
    const callTool = vi.fn(async (): Promise<ToolResult> => ({
      toolCallId: 'tc-3',
      name: 'generate',
      result: 'done',
      attachments: [{ source: 'data', kind: 'image', mimeType: 'image/png', data: 'b64' }],
    }));
    const getSignal = vi.fn(() => new AbortController().signal);

    const runToolCall = buildRunToolCall(setMessages, callTool, getSignal);
    await runToolCall({ id: 'tc-3', name: 'generate', arguments: {} });

    // The first call creates the tool message, the second updates with result+attachments
    expect(setMessages).toHaveBeenCalledTimes(2);
    const tcMsg = state.find((m: Message) => m.id === 'tc-3');
    expect(tcMsg?.toolCall?.status).toBe('done');
    expect(tcMsg?.toolCall?.attachments).toHaveLength(1);
  });

  it('handles null arguments in tool call', async () => {
    let state: Message[] = [];
    const setMessages = vi.fn((fn: (prev: Message[]) => Message[]) => {
      state = fn(state);
    });
    const callTool = vi.fn(async (_call: ToolCall, _signal: AbortSignal): Promise<ToolResult> => ({
      toolCallId: 'tc-4',
      name: 'echo',
      result: 'null-args',
    }));
    const getSignal = vi.fn(() => new AbortController().signal);

    const runToolCall = buildRunToolCall(setMessages, callTool, getSignal);
    const result = await runToolCall({ id: 'tc-4', name: 'echo', arguments: null as unknown as Record<string, unknown> });

    expect(result.result).toBe('null-args');
    expect(setMessages).toHaveBeenCalledTimes(2);
  });

  it('handles tool result with attachments spread into message', async () => {
    let state: Message[] = [];
    const setMessages = vi.fn((fn: (prev: Message[]) => Message[]) => {
      state = fn(state);
    });
    const callTool = vi.fn(async (): Promise<ToolResult> => ({
      toolCallId: 'tc-5',
      name: 'gen-img',
      result: 'image generated',
      attachments: [{ source: 'data', kind: 'image', mimeType: 'image/png', data: 'b64abc' }],
    }));
    const getSignal = vi.fn(() => new AbortController().signal);

    const runToolCall = buildRunToolCall(setMessages, callTool, getSignal);
    await runToolCall({ id: 'tc-5', name: 'gen-img', arguments: { prompt: 'cat' } });

    expect(setMessages).toHaveBeenCalledTimes(2);
    const tcMsg = state.find((m: Message) => m.id === 'tc-5');
    expect(tcMsg?.toolCall?.status).toBe('done');
    expect(tcMsg?.toolCall?.attachments).toHaveLength(1);
  });
});
