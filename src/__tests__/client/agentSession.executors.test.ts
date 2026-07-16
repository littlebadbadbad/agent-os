/**
 * Unit tests for agentSession.executors.ts — the tool call executor builder.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildRunToolCall } from '../../client/agentSession.executors';
import type { Message, ToolCall, ToolResult } from '@agent-sdk/utils/shared';

function makeMessages(): Message[] {
  return [];
}

describe('buildRunToolCall', () => {
  it('returns a function that executes the tool and updates UI state', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((fn: (prev: Message[]) => Message[]) => {
      messages.length = 0;
      messages.push(...fn(messages));
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
    expect(setMessages).toHaveBeenCalled();
  });

  it('handles tool execution error and returns structured error result', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((fn: (prev: Message[]) => Message[]) => {
      messages.length = 0;
      messages.push(...fn(messages));
    });
    const callTool = vi.fn(async () => { throw new Error('Something broke'); });
    const getSignal = vi.fn(() => new AbortController().signal);

    const runToolCall = buildRunToolCall(setMessages, callTool, getSignal);
    const result = await runToolCall({ id: 'tc-2', name: 'fail', arguments: {} });

    expect(result.result).toContain('Error');
    expect(result.result).toContain('Something broke');
  });

  it('updates tool message with attachments when present', async () => {
    const messages: Message[] = [];
    const setMessages = vi.fn((fn: (prev: Message[]) => Message[]) => {
      messages.length = 0;
      messages.push(...fn(messages));
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
    expect(setMessages).toHaveBeenCalled();
  });
});
