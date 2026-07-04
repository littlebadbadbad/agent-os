import { describe, it, expect } from 'vitest';
import { agentMessagesToUI } from '../../client/historyConverter';
import type { AgentMessage } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUMMARY_ANCHOR_PREFIX = '[Context summary]\n';
const SUMMARY_ANCHOR_ACK = 'Understood.';

// ── agentMessagesToUI ─────────────────────────────────────────────────────────

describe('agentMessagesToUI', () => {
  it('returns empty array for empty history', () => {
    expect(agentMessagesToUI([])).toEqual([]);
  });

  it('converts a user message to a UI message', () => {
    const history: AgentMessage[] = [{ role: 'user', content: 'Hello world' }];
    const result = agentMessagesToUI(history);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('Hello world');
    expect(result[0].isStreaming).toBe(false);
  });

  it('preserves user message id as a generated UUID', () => {
    const history: AgentMessage[] = [{ role: 'user', content: 'Hi' }];
    const result = agentMessagesToUI(history);
    expect(result[0].id).toBeDefined();
    expect(typeof result[0].id).toBe('string');
  });

  it('passes through user message attachments', () => {
    const attachment = { source: 'url' as const, kind: 'image' as const, url: 'https://example.com/img.png' };
    const history: AgentMessage[] = [{ role: 'user', content: 'See this', attachments: [attachment] }];
    const result = agentMessagesToUI(history);
    expect(result[0].attachments).toEqual([attachment]);
  });

  it('converts an assistant message with content to a UI message', () => {
    const history: AgentMessage[] = [{ role: 'assistant', content: 'Sure, let me help.' }];
    const result = agentMessagesToUI(history);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('Sure, let me help.');
  });

  it('skips assistant messages with empty content', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: 'Go' },
      { role: 'assistant', content: '' }, // no content → skipped
      { role: 'assistant', content: 'Done' },
    ];
    const result = agentMessagesToUI(history);
    const assistantMsgs = result.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe('Done');
  });

  it('passes through assistant message attachments', () => {
    const attachment = { source: 'url' as const, kind: 'image' as const, url: 'https://example.com/image.png' };
    const history: AgentMessage[] = [{ role: 'assistant', content: 'Here you go', attachments: [attachment] }];
    const result = agentMessagesToUI(history);
    expect(result[0].attachments).toEqual([attachment]);
  });

  it('converts a tool message to a UI tool call message', () => {
    const history: AgentMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: { x: 1 } }] },
      { role: 'tool', toolCallId: 'tc1', name: 'my_tool', content: 'tool result' },
    ];
    const result = agentMessagesToUI(history);
    const toolMsg = result.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.id).toBe('tc1');
    expect(toolMsg!.toolCall).toMatchObject({
      toolCallId: 'tc1',
      name: 'my_tool',
      status: 'done',
      result: 'tool result',
    });
  });

  it('includes tool call arguments in the tool message using the pre-built lookup', () => {
    const history: AgentMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'cats' } }] },
      { role: 'tool', toolCallId: 'tc1', name: 'search', content: 'results' },
    ];
    const result = agentMessagesToUI(history);
    const toolMsg = result.find((m) => m.role === 'tool');
    expect(toolMsg!.toolCall!.arguments).toEqual({ q: 'cats' });
  });

  it('uses empty object for arguments when tool call id is not found', () => {
    const history: AgentMessage[] = [
      { role: 'tool', toolCallId: 'tc-unknown', name: 'ghost', content: 'result' },
    ];
    const result = agentMessagesToUI(history);
    expect(result[0].toolCall!.arguments).toEqual({});
  });

  it('detects summary anchor pair and emits a compressed notice', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: `${SUMMARY_ANCHOR_PREFIX}Earlier summary text` },
      { role: 'assistant', content: SUMMARY_ANCHOR_ACK },
    ];
    const result = agentMessagesToUI(history);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('_Context compressed (restored from summary)_');
  });

  it('skips exactly 2 messages for the summary anchor pair', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: `${SUMMARY_ANCHOR_PREFIX}Earlier summary` },
      { role: 'assistant', content: SUMMARY_ANCHOR_ACK },
      { role: 'user', content: 'After summary' },
    ];
    const result = agentMessagesToUI(history);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('_Context compressed (restored from summary)_');
    expect(result[1].content).toBe('After summary');
  });

  it('does NOT treat a user message as anchor if ack is missing', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: `${SUMMARY_ANCHOR_PREFIX}Summary` },
      { role: 'assistant', content: 'Something else' }, // not the ack
    ];
    const result = agentMessagesToUI(history);
    // Should be rendered normally, not compressed
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
  });

  it('does NOT treat as anchor if user message does not start with prefix', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: 'Regular question' },
      { role: 'assistant', content: SUMMARY_ANCHOR_ACK },
    ];
    const result = agentMessagesToUI(history);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('Regular question');
  });

  it('handles a summary anchor at a non-start position (no special handling)', () => {
    // The anchor detection only fires when the current message starts with the prefix
    // and is followed by the ack — it can occur anywhere in the history
    const history: AgentMessage[] = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: `${SUMMARY_ANCHOR_PREFIX}Mid-summary` },
      { role: 'assistant', content: SUMMARY_ANCHOR_ACK },
      { role: 'user', content: 'After' },
    ];
    const result = agentMessagesToUI(history);
    // The anchor at index 2 is also detected → compressed notice + "After"
    expect(result.some((m) => m.content === '_Context compressed (restored from summary)_')).toBe(true);
  });

  it('handles a full conversation with user, assistant, and tool messages', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: 'Fetch data' },
      { role: 'assistant', content: 'Fetching...', toolCalls: [{ id: 'c1', name: 'fetch', arguments: { url: 'https://api.example.com' } }] },
      { role: 'tool', toolCallId: 'c1', name: 'fetch', content: '{"data": 42}' },
      { role: 'assistant', content: 'Got the data!' },
    ];
    const result = agentMessagesToUI(history);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[2].role).toBe('tool');
    expect(result[3].role).toBe('assistant');
  });

  it('handles user message with non-string content (falls back to empty string)', () => {
    // Covers the false branch of `typeof msg.content === 'string' ? msg.content : ''`
    const history = [{ role: 'user', content: ['part1', 'part2'] }] as unknown as AgentMessage[];
    const result = agentMessagesToUI(history);
    // Non-string content falls back to empty string
    expect(result[0].content).toBe('');
  });

  it('detects summary anchor pair when ack has trailing whitespace', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: `${SUMMARY_ANCHOR_PREFIX}Earlier summary text` },
      { role: 'assistant', content: `${SUMMARY_ANCHOR_ACK} ` }, // trailing space
    ];
    const result = agentMessagesToUI(history);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('_Context compressed (restored from summary)_');
  });

  it('silently skips messages with unknown role', () => {
    // Covers the final else branch of the role chain (msg.role !== 'user|assistant|tool')
    const history = [{ role: 'system', content: 'You are helpful' }] as unknown as AgentMessage[];
    const result = agentMessagesToUI(history);
    // Unknown role is silently ignored
    expect(result).toHaveLength(0);
  });
});
