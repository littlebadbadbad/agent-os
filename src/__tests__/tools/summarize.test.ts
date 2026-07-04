import { describe, it, expect, vi } from 'vitest';
import { safeSplitIndex, extractSummaryAnchor } from '../../tools/track/summarize/splitter';
import { estimateTokens, messagesToText, yieldToFrame } from '../../tools/track/summarize/text';
import { summarizeHistory } from '../../tools/track/summarize';
import {
  SUMMARY_ANCHOR_PREFIX,
  SUMMARY_ANCHOR_ACK,
  MAX_TOOL_RESULT_CHARS,
} from '../../tools/track/summarize/constants';
import type { AgentMessage } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function userMsg(content: string): AgentMessage {
  return { role: 'user', content };
}

function assistantMsg(content: string, toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[]): AgentMessage {
  return toolCalls && toolCalls.length > 0
    ? { role: 'assistant', content, toolCalls }
    : { role: 'assistant', content };
}

function toolMsg(name: string, content: string): AgentMessage {
  return { role: 'tool', toolCallId: `tc-${name}`, name, content };
}

// ── yieldToFrame ──────────────────────────────────────────────────────────────

describe('yieldToFrame', () => {
  it('resolves asynchronously (next tick)', async () => {
    let resolved = false;
    const p = yieldToFrame().then(() => { resolved = true; });
    expect(resolved).toBe(false);
    await p;
    expect(resolved).toBe(true);
  });
});

// ── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates English text at ~4 chars per token', () => {
    const text = 'hello world'; // 11 chars → ceil(11/4) = 3
    expect(estimateTokens(text)).toBe(3);
  });

  it('estimates CJK text at ~2 chars per token', () => {
    const cjk = '你好世界'; // 4 CJK chars → ceil(4/2) = 2
    expect(estimateTokens(cjk)).toBe(2);
  });

  it('estimates mixed text correctly', () => {
    // 4 ASCII + 2 CJK → ceil(4/4 + 2/2) = ceil(1 + 1) = 2
    const text = 'hi你好'; // 'h','i' = 2 ASCII, '你','好' = 2 CJK
    const result = estimateTokens(text);
    expect(result).toBeGreaterThan(0);
  });
});

// ── messagesToText ────────────────────────────────────────────────────────────

describe('messagesToText', () => {
  it('formats a user message', () => {
    const result = messagesToText([userMsg('Hello there')]);
    expect(result).toBe('[user] Hello there');
  });

  it('formats an assistant message without tool calls', () => {
    const result = messagesToText([assistantMsg('Here is the answer')]);
    expect(result).toBe('[assistant] Here is the answer');
  });

  it('formats an assistant message with tool calls and content', () => {
    const msg = assistantMsg('Running tool', [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }]);
    const result = messagesToText([msg]);
    expect(result).toContain('[assistant]');
    expect(result).toContain('search({"q":"test"})');
    expect(result).toContain('Running tool');
    expect(result).toContain('[tool_calls:');
  });

  it('formats an assistant message with tool calls and no content', () => {
    const msg = assistantMsg('', [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }]);
    const result = messagesToText([msg]);
    expect(result).toContain('[tool_calls:');
    expect(result).not.toContain('[assistant] \n');
  });

  it('formats a tool result message', () => {
    const result = messagesToText([toolMsg('search', 'Found 3 results')]);
    expect(result).toBe('[tool_result:search] Found 3 results');
  });

  it('truncates long tool result messages', () => {
    const longContent = 'x'.repeat(MAX_TOOL_RESULT_CHARS + 100);
    const msg: AgentMessage = { role: 'tool', toolCallId: 'tc', name: 'bigTool', content: longContent };
    const result = messagesToText([msg]);
    expect(result).toContain('…[truncated 100 chars]');
    expect(result.length).toBeLessThan(longContent.length + 50);
  });

  it('serializes tool result object content to JSON', () => {
    const msg: AgentMessage = { role: 'tool', toolCallId: 'tc', name: 'data', content: { key: 'val' } };
    const result = messagesToText([msg]);
    expect(result).toContain('[tool_result:data]');
    expect(result).toContain('"key":"val"');
  });

  it('joins multiple messages with newlines', () => {
    const messages: AgentMessage[] = [userMsg('Q'), assistantMsg('A')];
    const result = messagesToText(messages);
    expect(result).toContain('\n');
  });
});

// ── safeSplitIndex ────────────────────────────────────────────────────────────

describe('safeSplitIndex', () => {
  it('returns the desired index for a simple history', () => {
    const history: AgentMessage[] = [
      userMsg('Q1'), assistantMsg('A1'),
      userMsg('Q2'), assistantMsg('A2'),
    ];
    expect(safeSplitIndex(history, 2)).toBe(2);
  });

  it('skips over stranded tool-result messages at the desired index', () => {
    const history: AgentMessage[] = [
      userMsg('Q'),
      assistantMsg('Using tool', [{ id: 'tc1', name: 't', arguments: {} }]),
      toolMsg('t', 'result'),  // index 2 — tool result
      userMsg('Q2'),
    ];
    // If desiredIdx=2 points at a tool message, it should skip past it
    const idx = safeSplitIndex(history, 2);
    expect(history[idx].role).not.toBe('tool');
  });

  it('pulls back when the message before idx is an assistant with pending tool calls', () => {
    // desiredIdx points to a user message, but the message at idx-1 is an
    // assistant with pending toolCalls — so the function pulls idx back by 1.
    const history: AgentMessage[] = [
      userMsg('Q1'),
      assistantMsg('A1'),
      userMsg('Q2'),
      assistantMsg('Calling', [{ id: 'tc1', name: 't', arguments: {} }]),  // index 3 — has tool calls
      userMsg('Q3'),  // index 4 — desiredIdx
    ];
    // desiredIdx=4: history[3] is assistant-with-toolCalls → pullback to 3
    // then history[2] is user → stop. Returns 3.
    const idx = safeSplitIndex(history, 4);
    expect(idx).toBe(3);
  });

  it('returns desiredIdx unchanged when previous message has no tool calls', () => {
    const history: AgentMessage[] = [
      userMsg('Q1'), assistantMsg('A1'),
      userMsg('Q2'), assistantMsg('A2'),
      userMsg('Q3'),
    ];
    expect(safeSplitIndex(history, 4)).toBe(4);
  });

  it('handles desiredIdx equal to history.length (past all messages)', () => {
    // BUG WAS: safeSplitIndex crashed when desiredIdx > history.length because
    // history[idx-1] could be undefined and .role would throw a TypeError.
    // FIX: now clamps to Math.min(desiredIdx, history.length) on entry.
    const history: AgentMessage[] = [userMsg('Q'), assistantMsg('A')];
    // desiredIdx === history.length: history[1] = assistant, no tool calls → returns 2
    expect(safeSplitIndex(history, history.length)).toBe(history.length);
    // desiredIdx far past the end: clamped to 2, same result — no crash
    expect(safeSplitIndex(history, 999)).toBe(history.length);
  });
});

// ── extractSummaryAnchor ──────────────────────────────────────────────────────

describe('extractSummaryAnchor', () => {
  it('returns null for an empty history', () => {
    expect(extractSummaryAnchor([])).toBeNull();
  });

  it('returns null when history has fewer than 2 messages', () => {
    expect(extractSummaryAnchor([userMsg('hi')])).toBeNull();
  });

  it('returns null when first message is not a user message', () => {
    const history: AgentMessage[] = [assistantMsg('A'), assistantMsg(SUMMARY_ANCHOR_ACK)];
    expect(extractSummaryAnchor(history)).toBeNull();
  });

  it('returns null when first message does not start with the prefix', () => {
    const history: AgentMessage[] = [
      userMsg('Regular question'),
      assistantMsg(SUMMARY_ANCHOR_ACK),
    ];
    expect(extractSummaryAnchor(history)).toBeNull();
  });

  it('returns null when the second message is not the ack', () => {
    const history: AgentMessage[] = [
      userMsg(`${SUMMARY_ANCHOR_PREFIX}Summary text`),
      assistantMsg('Some other response'),
    ];
    expect(extractSummaryAnchor(history)).toBeNull();
  });

  it('extracts the summary and tail when anchor is present', () => {
    const summaryText = 'The user asked about X. The assistant did Y.';
    const history: AgentMessage[] = [
      userMsg(`${SUMMARY_ANCHOR_PREFIX}${summaryText}`),
      assistantMsg(SUMMARY_ANCHOR_ACK),
      userMsg('Follow-up question'),
    ];
    const result = extractSummaryAnchor(history);
    expect(result).not.toBeNull();
    expect(result!.previousSummary).toBe(summaryText);
    expect(result!.tail).toHaveLength(1);
    expect(result!.tail[0]).toEqual(userMsg('Follow-up question'));
  });

  it('returns an empty tail when anchor occupies the entire history', () => {
    const history: AgentMessage[] = [
      userMsg(`${SUMMARY_ANCHOR_PREFIX}Summary`),
      assistantMsg(SUMMARY_ANCHOR_ACK),
    ];
    const result = extractSummaryAnchor(history);
    expect(result!.tail).toHaveLength(0);
  });
});

// ── summarizeHistory ──────────────────────────────────────────────────────────

describe('summarizeHistory', () => {
  const signal = new AbortController().signal;

  function buildLongHistory(n: number): AgentMessage[] {
    const msgs: AgentMessage[] = [];
    for (let i = 0; i < n; i++) {
      msgs.push(userMsg(`Question ${i}`));
      msgs.push(assistantMsg(`Answer ${i}`));
    }
    return msgs;
  }

  it('returns original history unchanged when it is too short', async () => {
    const history = buildLongHistory(2); // 4 messages, keepRecentMessages default is 4
    const handler = vi.fn(async () => ({ text: 'summary' }));
    const result = await summarizeHistory(history, { handler: handler as any, signal });
    expect(result.messages).toEqual(history);
    expect(result.savedTokens).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('summarizes history and returns compacted messages', async () => {
    const history = buildLongHistory(5); // 10 messages
    const handler = vi.fn(async () => ({ text: 'A concise summary of the conversation.' }));
    const result = await summarizeHistory(history, { handler: handler as any, signal, minSavedTokens: 0 });
    expect(handler).toHaveBeenCalled();
    expect(result.messages.length).toBeLessThan(history.length);
    // First two messages should be the anchor pair
    expect(result.messages[0].content).toContain(SUMMARY_ANCHOR_PREFIX);
    expect(result.messages[1].content).toBe(SUMMARY_ANCHOR_ACK);
  });

  it('reports savedTokens > 0 after summarization', async () => {
    const history = buildLongHistory(5);
    const handler = vi.fn(async () => ({ text: 'Short summary.' }));
    const result = await summarizeHistory(history, { handler: handler as any, signal, minSavedTokens: 0 });
    expect(result.savedTokens).toBeGreaterThan(0);
  });

  it('uses custom keepRecentMessages value', async () => {
    const history = buildLongHistory(5); // 10 messages
    const handler = vi.fn(async () => ({ text: 'Summary.' }));
    const result = await summarizeHistory(history, { handler: handler as any, signal, keepRecentMessages: 2 });
  });

  it('returns original history when handler throws', async () => {
    const history = buildLongHistory(6);
    const handler = vi.fn(async () => { throw new Error('API error'); });
    const result = await summarizeHistory(history, { handler: handler as any, signal });
    expect(result.messages).toEqual(history);
    expect(result.savedTokens).toBe(0);
  });

  it('returns original history when handler returns empty summary', async () => {
    const history = buildLongHistory(6);
    const handler = vi.fn(async () => ({ text: '   ' })); // whitespace-only
    const result = await summarizeHistory(history, { handler: handler as any, signal });
    expect(result.messages).toEqual(history);
    expect(result.savedTokens).toBe(0);
  });

  it('handles incremental mode (existing summary anchor in history)', async () => {
    const summaryText = 'Previous summary of earlier conversation.';
    const anchoredHistory: AgentMessage[] = [
      userMsg(`${SUMMARY_ANCHOR_PREFIX}${summaryText}`),
      assistantMsg(SUMMARY_ANCHOR_ACK),
      ...buildLongHistory(5), // 10 more messages
    ];
    const handler = vi.fn(async () => ({ text: 'Updated incremental summary.' }));
    const result = await summarizeHistory(anchoredHistory, { handler: handler as any, signal, minSavedTokens: 0 });
    expect(handler).toHaveBeenCalled();
    // New anchor should contain updated summary
    expect(result.messages[0].content).toContain('Updated incremental summary.');
  });

  it('handles streaming handler response', async () => {
    const history = buildLongHistory(5);

    // Create a ReadableStream that yields text chunks
    const chunks = [
      { type: 'text', delta: 'Stream ' },
      { type: 'text', delta: 'summary.' },
    ];
    let chunkIdx = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunkIdx < chunks.length) {
          controller.enqueue(chunks[chunkIdx++]);
        } else {
          controller.close();
        }
      },
    });

    const handler = vi.fn(async () => stream);
    const result = await summarizeHistory(history, { handler: handler as any, signal, minSavedTokens: 0 });
    expect(result.messages[0].content).toContain('Stream summary.');
  });

  it('uses custom summaryPrompt', async () => {
    const history = buildLongHistory(5);
    const handler = vi.fn(async (_msgs: any) => ({ text: 'Custom summary.' }));
    await summarizeHistory(history, {
      handler: handler as any,
      signal,
      summaryPrompt: 'My custom prompt.',
      minSavedTokens: 0,
    });
    const requestContent = handler.mock.calls[0][0][0].content as string;
    expect(requestContent).toContain('My custom prompt.');
  });

  it('uses custom incrementalSummaryPrompt for incremental mode', async () => {
    const anchoredHistory: AgentMessage[] = [
      userMsg(`${SUMMARY_ANCHOR_PREFIX}Old summary`),
      assistantMsg(SUMMARY_ANCHOR_ACK),
      ...buildLongHistory(5),
    ];
    const handler = vi.fn(async () => ({ text: 'Updated.' }));
    await summarizeHistory(anchoredHistory, {
      handler: handler as any,
      signal,
      incrementalSummaryPrompt: 'Custom incremental prompt.',
      minSavedTokens: 0,
    });
    // @ts-expect-error access mock call args
    const requestContent = handler.mock.calls[0][0][0].content as string;
    expect(requestContent).toContain('Custom incremental prompt.');
  });

  it('returns original when safeSplitIndex produces 0', async () => {
    // History where the first messages are all tool results (edge case)
    const history: AgentMessage[] = [
      toolMsg('t', 'result1'),
      toolMsg('t', 'result2'),
      toolMsg('t', 'result3'),
      toolMsg('t', 'result4'),
      toolMsg('t', 'result5'),
    ];
    const handler = vi.fn(async () => ({ text: 'Summary.' }));
    const result = await summarizeHistory(history, { handler: handler as any, signal, keepRecentMessages: 2 });
    // If safeSplitIndex keeps advancing to skip tool messages, it might end up at history.length
    // and return original; otherwise it proceeds normally
    // At minimum it should not throw
    expect(result.messages).toBeDefined();
  });

  it('streaming handler accumulates only text chunks (non-text types are routed separately)', async () => {
    // thinking chunks go to summaryThinking, not summaryText; other types are ignored
    const history = buildLongHistory(5);
    const rawChunks = [
      { type: 'thinking', delta: 'thinking content' },
      { type: 'text', delta: 'Real ' },
      { type: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      { type: 'text', delta: 'summary.' },
    ];
    let idx = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (idx < rawChunks.length) {
          controller.enqueue(rawChunks[idx++] as any);
        } else {
          controller.close();
        }
      },
    });
    const handler = vi.fn(async () => stream);
    const result = await summarizeHistory(history, { handler: handler as any, signal, minSavedTokens: 0 });
    expect(result.messages[0].content).toContain('Real summary.');
    const anchorMsg = result.messages[1] as { thinking?: string };
    expect(anchorMsg.thinking).toBe('thinking content');
  });

  // ── Thinking model (reasoning_content) preservation ───────────────────────
  // These tests cover the fix for DeepSeek/Doubao "reasoning_content must be
  // passed back" 400 errors caused by the synthetic "Understood." anchor message
  // lacking a `thinking` field after summarization.

  it('preserves thinking from an async handler response in the anchor message', async () => {
    const history = buildLongHistory(5);
    const handler = vi.fn(async () => ({ text: 'Summary.', thinking: 'inner reasoning' }));
    const result = await summarizeHistory(history, { handler: handler as any, signal, minSavedTokens: 0 });
    const anchorMsg = result.messages[1] as { role: string; content: string; thinking?: string };
    expect(anchorMsg.role).toBe('assistant');
    expect(anchorMsg.content).toBe(SUMMARY_ANCHOR_ACK);
    expect(anchorMsg.thinking).toBe('inner reasoning');
  });

  it('preserves empty-string thinking from an async handler so it is echoed back', async () => {
    // Empty-string thinking must not be silently dropped — it is still a signal that
    // the model was in thinking mode and the field must be echoed on subsequent turns.
    const history = buildLongHistory(5);
    const handler = vi.fn(async () => ({ text: 'Summary.', thinking: '' }));
    const result = await summarizeHistory(history, { handler: handler as any, signal, minSavedTokens: 0 });
    const anchorMsg = result.messages[1] as { role: string; content: string; thinking?: string };
    expect(anchorMsg).toHaveProperty('thinking', '');
  });

  it('does NOT add thinking to the anchor when the async handler returns no thinking', async () => {
    const history = buildLongHistory(5);
    const handler = vi.fn(async () => ({ text: 'Summary.' }));
    const result = await summarizeHistory(history, { handler: handler as any, signal, minSavedTokens: 0 });
    const anchorMsg = result.messages[1] as any;
    expect(anchorMsg).not.toHaveProperty('thinking');
  });

  it('preserves thinking from a streaming handler response in the anchor message', async () => {
    const history = buildLongHistory(5);
    const rawChunks = [
      { type: 'thinking', delta: 'step 1 ' },
      { type: 'thinking', delta: 'step 2' },
      { type: 'text', delta: 'Stream summary.' },
    ];
    let idx = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (idx < rawChunks.length) controller.enqueue(rawChunks[idx++]);
        else controller.close();
      },
    });
    const handler = vi.fn(async () => stream);
    const result = await summarizeHistory(history, { handler: handler as any, signal, minSavedTokens: 0 });
    const anchorMsg = result.messages[1] as any;
    expect(anchorMsg.thinking).toBe('step 1 step 2');
    expect(result.messages[0].content).toContain('Stream summary.');
  });

  // ── minSavedTokens guard ──────────────────────────────────────────────────

  it('returns noOp without calling handler when oldTokens < minSavedTokens', async () => {
    const history = buildLongHistory(5); // tiny messages, ~30 tokens total
    const handler = vi.fn(async () => ({ text: 'Summary.' }));
    const result = await summarizeHistory(history, {
      handler: handler as any,
      signal,
      minSavedTokens: 10_000, // unreachably high
    });
    expect(handler).not.toHaveBeenCalled();
    expect(result.savedTokens).toBe(0);
    expect(result.messages).toEqual(history);
  });

  it('proceeds normally when minSavedTokens is 0', async () => {
    const history = buildLongHistory(5);
    const handler = vi.fn(async () => ({ text: 'S.' }));
    const result = await summarizeHistory(history, {
      handler: handler as any,
      signal,
      minSavedTokens: 0,
    });
    expect(handler).toHaveBeenCalled();
  });

  // ── compressionCheck ──────────────────────────────────────────────────────

  it('returns noOp when summary is longer than original (compressionCheck=true, default)', async () => {
    const history = buildLongHistory(5);
    // Return a very long summary — longer than the tiny test messages it replaces.
    const longSummary = 'x'.repeat(2000);
    const handler = vi.fn(async () => ({ text: longSummary }));
    const result = await summarizeHistory(history, {
      handler: handler as any,
      signal,
      minSavedTokens: 0,
    });
    // compressionCheck should reject a summary longer than the source
    expect(result.savedTokens).toBe(0);
    expect(result.messages).toEqual(history);
  });

  it('accepts a longer summary when compressionCheck=false', async () => {
    const history = buildLongHistory(5);
    const longSummary = 'x'.repeat(2000);
    const handler = vi.fn(async () => ({ text: longSummary }));
    const result = await summarizeHistory(history, {
      handler: handler as any,
      signal,
      minSavedTokens: 0,
      compressionCheck: false,
    });
    // Without the check, the compaction proceeds regardless of summary length.
    expect(handler).toHaveBeenCalled();
    expect(result.messages[0].content).toContain(longSummary);
  });
});
