import { describe, it, expect } from 'vitest';
import { createId, assistantMsg, toolMsg } from '../../../agent-UI/components/AgentWidget/helpers';
import type { ToolCallInfo } from '../../../agent-UI/components/AgentWidget/types';

describe('createId', () => {
  it('returns a non-empty string', () => {
    const id = createId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns a different value each call', () => {
    expect(createId()).not.toBe(createId());
  });
});

describe('assistantMsg', () => {
  it('creates a non-streaming assistant message by default', () => {
    const msg = assistantMsg('id-1', 'Hello world');
    expect(msg).toEqual({
      id: 'id-1',
      role: 'assistant',
      content: 'Hello world',
      isStreaming: false,
    });
  });

  it('creates a streaming assistant message when streaming=true', () => {
    const msg = assistantMsg('id-2', 'Thinking...', true);
    expect(msg.isStreaming).toBe(true);
  });
});

describe('toolMsg', () => {
  it('creates a tool message from ToolCallInfo', () => {
    const info: ToolCallInfo = {
      toolCallId: 'tc-1',
      name: 'my_tool',
      arguments: { query: 'test' },
      status: 'done',
      result: { output: 42 },
    };
    const msg = toolMsg(info);
    expect(msg).toEqual({
      id: 'tc-1',
      role: 'tool',
      content: '',
      isStreaming: false,
      toolCall: info,
    });
  });

  it('sets toolCallId as the message id', () => {
    const info: ToolCallInfo = {
      toolCallId: 'tc-xyz',
      name: 'echo',
      arguments: {},
      status: 'running',
    };
    expect(toolMsg(info).id).toBe('tc-xyz');
  });
});
