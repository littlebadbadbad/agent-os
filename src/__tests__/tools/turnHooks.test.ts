/**
 * Tests for createTurnHooks — the AgentLoopHooks factory extracted from
 * conversationRunner.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTurnHooks, type TurnRefs, type TurnHookDeps } from '../../tools/turnHooks';
import { createMessageList, assistantMsg } from '../../tools/messageList';
import { createHistoryTracker } from '../../tools/historyTracker';
import { createToolSetScope } from '../../tools/toolSetScope';
import { makeBatchedAppender } from '../../tools/streamingBatcher';
import type { ToolSetContext, ToolSet, ToolResult, ToolCall } from '@agent-type';

const MINIMAL_CTX: ToolSetContext = {
  sessionId: 'sess-1',
  agentName: 'main',
  conversationId: 'main',
};

function makeDeps(overrides: Partial<TurnHookDeps> = {}): TurnHookDeps {
  const msgList = createMessageList();
  const tracker = createHistoryTracker();
  const turnRef: TurnRefs = { assistantId: 'assistant-1', followUpId: '' };
  const mainContent = makeBatchedAppender(vi.fn());
  const mainThinking = makeBatchedAppender(vi.fn());
  const scope = createToolSetScope(() => [], vi.fn());

  return {
    turnRef,
    msgList,
    mainContent,
    mainThinking,
    scope,
    tsCtx: MINIMAL_CTX,
    tracker,
    ...overrides,
  };
}

describe('createTurnHooks', () => {
  it('returns an object with all expected hook methods', () => {
    const hooks = createTurnHooks(makeDeps());
    expect(hooks.onTurnBegin).toBeInstanceOf(Function);
    expect(hooks.onAssistantText).toBeInstanceOf(Function);
    expect(hooks.onStreamEnd).toBeInstanceOf(Function);
    expect(hooks.onTextDelta).toBeInstanceOf(Function);
    expect(hooks.onThinkingDelta).toBeInstanceOf(Function);
    expect(hooks.onFirstToolSeen).toBeInstanceOf(Function);
    expect(hooks.onBeforeToolCalls).toBeInstanceOf(Function);
    expect(hooks.onAfterToolCall).toBeInstanceOf(Function);
    expect(hooks.onPreExecutedResult).toBeInstanceOf(Function);
    expect(hooks.onAttachment).toBeInstanceOf(Function);
    expect(hooks.onBeforeInvoke).toBeInstanceOf(Function);
    expect(hooks.onAfterTurn).toBeInstanceOf(Function);
  });

  describe('onTurnBegin', () => {
    it('does nothing for turn 0', () => {
      const deps = makeDeps();
      const hooks = createTurnHooks(deps);
      hooks.onTurnBegin?.(0);
      expect(deps.msgList.messages).toHaveLength(0);
    });

    it('creates a new streaming assistant message for turn > 0', () => {
      const deps = makeDeps();
      const hooks = createTurnHooks(deps);
      hooks.onTurnBegin?.(1);
      expect(deps.msgList.messages.length).toBeGreaterThanOrEqual(1);
      const lastMsg = deps.msgList.messages[deps.msgList.messages.length - 1];
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.isStreaming).toBe(true);
    });
  });

  describe('onBeforeToolCalls', () => {
    it('adds a tool message for each call', () => {
      const deps = makeDeps();
      const hooks = createTurnHooks(deps);
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'tool_a', arguments: { x: 1 } },
        { id: 'call-2', name: 'tool_b', arguments: {} },
      ];
      hooks.onBeforeToolCalls?.(calls);
      const toolMsgs = deps.msgList.messages.filter((m) => m.toolCall);
      expect(toolMsgs).toHaveLength(2);
      expect(toolMsgs[0].id).toBe('call-1');
      expect(toolMsgs[1].id).toBe('call-2');
    });
  });

  describe('onAfterToolCall', () => {
    it('updates the existing tool message when it exists', () => {
      const deps = makeDeps();
      const hooks = createTurnHooks(deps);
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'tool_a', arguments: {} },
      ];
      hooks.onBeforeToolCalls?.(calls);

      const result: ToolResult = { toolCallId: 'call-1', name: 'tool_a', result: 'success' };
      hooks.onAfterToolCall?.(calls[0], result);

      const toolMsg = deps.msgList.messages.find((m) => m.id === 'call-1');
      expect(toolMsg?.toolCall?.status).toBe('done');
      expect(toolMsg?.toolCall?.result).toBe('success');
    });

    it('creates a new tool message when not previously registered (streaming path)', () => {
      const deps = makeDeps();
      const hooks = createTurnHooks(deps);
      const call: ToolCall = { id: 'call-stream', name: 'tool_s', arguments: {} };
      const result: ToolResult = { toolCallId: 'call-stream', name: 'tool_s', result: 'stream-ok' };

      hooks.onAfterToolCall?.(call, result);

      const toolMsg = deps.msgList.messages.find((m) => m.id === 'call-stream');
      expect(toolMsg).toBeDefined();
      expect(toolMsg?.toolCall?.status).toBe('done');
    });

    it('marks errors with status "error"', () => {
      const deps = makeDeps();
      const hooks = createTurnHooks(deps);
      const call: ToolCall = { id: 'call-err', name: 'tool_e', arguments: {} };
      const result: ToolResult = { toolCallId: 'call-err', name: 'tool_e', result: 'Error: something broke' };

      hooks.onAfterToolCall?.(call, result);

      const toolMsg = deps.msgList.messages.find((m) => m.id === 'call-err');
      expect(toolMsg?.toolCall?.status).toBe('error');
      expect(toolMsg?.toolCall?.error).toBe('Error: something broke');
    });
  });

  describe('onPreExecutedResult', () => {
    it('adds a done tool message', () => {
      const deps = makeDeps();
      const hooks = createTurnHooks(deps);
      const call: ToolCall = { id: 'pre-call', name: 'tool_p', arguments: {} };
      const result: ToolResult = { toolCallId: 'pre-call', name: 'tool_p', result: 'pre-ok' };

      hooks.onPreExecutedResult?.(call, result);

      const toolMsg = deps.msgList.messages.find((m) => m.id === 'pre-call');
      expect(toolMsg).toBeDefined();
      expect(toolMsg?.toolCall?.status).toBe('done');
      expect(toolMsg?.toolCall?.result).toBe('pre-ok');
    });
  });

  describe('onAttachment', () => {
    it('appends attachment to the assistant message', () => {
      const deps = makeDeps();
      // Push a placeholder assistant message first (matching conversationRunner setup)
      deps.msgList.push(assistantMsg(deps.turnRef.assistantId, '', true));
      deps.msgList.push(assistantMsg(deps.turnRef.assistantId, '', true));
      const hooks = createTurnHooks(deps);

      const attachment = { source: 'data' as const, kind: 'image' as const, mimeType: 'image/png', data: 'abc' };
      hooks.onAttachment?.(attachment);

      const targetId = deps.turnRef.followUpId || deps.turnRef.assistantId;
      const msg = deps.msgList.messages.find((m) => m.id === targetId);
      expect(msg).toBeDefined();
      expect(msg?.attachments).toHaveLength(1);
      expect(msg?.attachments?.[0]).toBe(attachment);
    });
  });
});
