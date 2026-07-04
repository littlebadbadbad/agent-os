import { describe, it, expect } from 'vitest';
import { isDataAttachment, isUrlAttachment } from '../../tools/messages/attachment';
import { toOpenAIMessages } from '../../tools/messages/openai';
import { toAnthropicMessages } from '../../tools/messages/anthropic';
import { toGeminiMessages } from '../../tools/messages/gemini';
// Import from the barrel to ensure the re-export index is covered
import { toOpenAIMessages as _toOAI, toAnthropicMessages as _toAnth, toGeminiMessages as _toGemini } from '../../tools/messages';
import type { AgentMessage, DataAttachment, UrlAttachment } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

const urlImg: UrlAttachment = { source: 'url', kind: 'image', url: 'https://example.com/img.png' };
const dataImg: DataAttachment = { source: 'data', kind: 'image', mimeType: 'image/png', data: 'abc123' };
const dataDoc: DataAttachment = { source: 'data', kind: 'document', mimeType: 'application/pdf', data: 'pdfdata', name: 'report.pdf' };
const dataAudio: DataAttachment = { source: 'data', kind: 'audio', mimeType: 'audio/mp3', data: 'audiodata', name: 'clip.mp3' };
const dataVideo: DataAttachment = { source: 'data', kind: 'video', mimeType: 'video/mp4', data: 'viddata' };
const dataDocNoName: DataAttachment = { source: 'data', kind: 'document', mimeType: 'application/pdf', data: 'pdfdata' };

// ── isDataAttachment ──────────────────────────────────────────────────────────

describe('isDataAttachment', () => {
  it('returns true for data attachments', () => {
    expect(isDataAttachment(dataImg)).toBe(true);
    expect(isDataAttachment(dataDoc)).toBe(true);
  });

  it('returns false for url attachments', () => {
    expect(isDataAttachment(urlImg)).toBe(false);
  });
});

// ── isUrlAttachment ───────────────────────────────────────────────────────────

describe('isUrlAttachment', () => {
  it('returns true for url attachments', () => {
    expect(isUrlAttachment(urlImg)).toBe(true);
  });

  it('returns false for data attachments', () => {
    expect(isUrlAttachment(dataImg)).toBe(false);
    expect(isUrlAttachment(dataDoc)).toBe(false);
  });
});

// ── toOpenAIMessages ──────────────────────────────────────────────────────────

describe('toOpenAIMessages', () => {
  it('converts a simple user message', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: 'Hello' }];
    const result = toOpenAIMessages(msgs);
    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('converts a user message with no content and no attachments', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '' }];
    const result = toOpenAIMessages(msgs);
    expect(result).toEqual([{ role: 'user', content: '' }]);
  });

  it('converts a user message with a URL image attachment', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: 'Check this', attachments: [urlImg] }];
    const result = toOpenAIMessages(msgs);
    expect(result).toHaveLength(1);
    const content = result[0].content as any[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'text', text: 'Check this' });
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: urlImg.url, detail: 'auto' } });
  });

  it('converts a user message with a base64 image attachment', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataImg] }];
    const result = toOpenAIMessages(msgs);
    const content = result[0].content as any[];
    // no text part when content is empty
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('image_url');
    expect(content[0].image_url.url).toBe(`data:image/png;base64,abc123`);
  });

  it('converts a user message with a non-image data attachment', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataDoc] }];
    const result = toOpenAIMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0]).toEqual({ type: 'text', text: '[Attached document: report.pdf]' });
  });

  it('uses kind and mimeType as label when name is absent', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataDocNoName] }];
    const result = toOpenAIMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0].text).toBe('[Attached document: document file (application/pdf)]');
  });

  it('converts an assistant message without tool calls', () => {
    const msgs: AgentMessage[] = [{ role: 'assistant', content: 'Hi there' }];
    const result = toOpenAIMessages(msgs);
    expect(result).toEqual([{ role: 'assistant', content: 'Hi there' }]);
  });

  it('converts an assistant message with thinking (reasoning_content)', () => {
    const msgs: AgentMessage[] = [{ role: 'assistant', content: 'Answer', thinking: 'chain of thought' }];
    const result = toOpenAIMessages(msgs);
    expect(result[0]).toMatchObject({ role: 'assistant', content: 'Answer', reasoning_content: 'chain of thought' });
  });

  it('echoes empty-string thinking as reasoning_content without dropping it', () => {
    // Thinking models require reasoning_content echoed back even when empty — dropping it
    // causes DeepSeek/Doubao to return a 400 "reasoning_content must be passed back" error.
    const msgs: AgentMessage[] = [{ role: 'assistant', content: 'Answer', thinking: '' }];
    const result = toOpenAIMessages(msgs);
    expect(result[0]).toHaveProperty('reasoning_content', '');
  });

  it('does NOT add reasoning_content when thinking is absent', () => {
    const msgs: AgentMessage[] = [{ role: 'assistant', content: 'Answer' }];
    const result = toOpenAIMessages(msgs);
    expect(result[0]).not.toHaveProperty('reasoning_content');
  });

  it('converts an assistant message with tool calls', () => {
    const msgs: AgentMessage[] = [{
      role: 'assistant',
      content: 'Calling tool',
      toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: { key: 'val' } }],
    }];
    const result = toOpenAIMessages(msgs);
    expect(result[0]).toMatchObject({
      role: 'assistant',
      content: 'Calling tool',
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'my_tool', arguments: '{"key":"val"}' } }],
    });
  });

  it('converts a tool result message with string content', () => {
    const msgs: AgentMessage[] = [{ role: 'tool', toolCallId: 'tc1', name: 'my_tool', content: 'result text' }];
    const result = toOpenAIMessages(msgs);
    expect(result).toEqual([{ role: 'tool', tool_call_id: 'tc1', content: 'result text' }]);
  });

  it('converts a tool result message with object content', () => {
    const msgs: AgentMessage[] = [{ role: 'tool', toolCallId: 'tc1', name: 'my_tool', content: { items: [1, 2] } }];
    const result = toOpenAIMessages(msgs);
    expect(result[0]).toMatchObject({ role: 'tool', tool_call_id: 'tc1', content: '{"items":[1,2]}' });
  });

  it('converts a multi-turn conversation', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi', toolCalls: [{ id: 'c1', name: 'echo', arguments: {} }] },
      { role: 'tool', toolCallId: 'c1', name: 'echo', content: 'pong' },
      { role: 'assistant', content: 'Done' },
    ];
    const result = toOpenAIMessages(msgs);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[2].role).toBe('tool');
    expect(result[3].role).toBe('assistant');
  });

  it('handles user message with attachment but no text content', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [urlImg] }];
    const result = toOpenAIMessages(msgs);
    const content = result[0].content as any[];
    // No text part since content is empty
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('image_url');
  });

  it('handles audio attachment as text notice', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataAudio] }];
    const result = toOpenAIMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0].text).toBe('[Attached audio: clip.mp3]');
  });

  it('handles video attachment without name as text notice', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataVideo] }];
    const result = toOpenAIMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0].text).toBe('[Attached video: video file (video/mp4)]');
  });

  it('silently skips messages with an unknown role', () => {
    // Covers the false branch after `else if (msg.role === 'tool')` (line 64 in openai.ts)
    const msgs = [{ role: 'system', content: 'You are helpful' }] as unknown as AgentMessage[];
    const result = toOpenAIMessages(msgs);
    expect(result).toHaveLength(0);
  });
});

// ── toAnthropicMessages ───────────────────────────────────────────────────────

describe('toAnthropicMessages', () => {
  it('converts a simple user message', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: 'Hello' }];
    const result = toAnthropicMessages(msgs);
    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('converts a user message with URL image attachment', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: 'See this', attachments: [urlImg] }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'image', source: { type: 'url', url: urlImg.url } });
    expect(content[1]).toEqual({ type: 'text', text: 'See this' });
  });

  it('converts a user message with base64 image attachment', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataImg] }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } });
  });

  it('converts a user message with document attachment (with name)', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataDoc] }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'pdfdata' }, title: 'report.pdf' });
  });

  it('converts a user message with document attachment (no name)', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataDocNoName] }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'base64' } });
    expect(content[0].title).toBeUndefined();
  });

  it('converts audio attachment as text notice', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataAudio] }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0]).toEqual({ type: 'text', text: '[Attached audio: clip.mp3]' });
  });

  it('converts video attachment without name as text notice', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataVideo] }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0]).toEqual({ type: 'text', text: '[Attached video: video file (video/mp4)]' });
  });

  it('converts an assistant message without tool calls', () => {
    const msgs: AgentMessage[] = [{ role: 'assistant', content: 'Hello' }];
    const result = toAnthropicMessages(msgs);
    expect(result).toEqual([{ role: 'assistant', content: 'Hello' }]);
  });

  it('converts an assistant message with tool calls', () => {
    const msgs: AgentMessage[] = [{
      role: 'assistant',
      content: 'Running tool',
      toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'cats' } }],
    }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0]).toEqual({ type: 'text', text: 'Running tool' });
    expect(content[1]).toEqual({ type: 'tool_use', id: 'tc1', name: 'search', input: { q: 'cats' } });
  });

  it('converts an assistant message with tool calls but no content', () => {
    const msgs: AgentMessage[] = [{
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc1', name: 'search', arguments: {} }],
    }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    // No text block when content is empty
    expect(content.find((b: any) => b.type === 'tool_use')).toBeDefined();
    expect(content.find((b: any) => b.type === 'text')).toBeUndefined();
  });

  it('converts an assistant message with attachments', () => {
    const msgs: AgentMessage[] = [{
      role: 'assistant',
      content: 'Here is an image',
      attachments: [urlImg],
    }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    expect(content.some((b: any) => b.type === 'image')).toBe(true);
  });

  it('merges consecutive tool results into a single user message', () => {
    const msgs: AgentMessage[] = [
      { role: 'tool', toolCallId: 'tc1', name: 't1', content: 'r1' },
      { role: 'tool', toolCallId: 'tc2', name: 't2', content: 'r2' },
    ];
    const result = toAnthropicMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    const content = result[0].content as any[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'tool_result', tool_use_id: 'tc1', content: 'r1' });
    expect(content[1]).toEqual({ type: 'tool_result', tool_use_id: 'tc2', content: 'r2' });
  });

  it('flushes tool results when a non-tool message follows', () => {
    const msgs: AgentMessage[] = [
      { role: 'tool', toolCallId: 'tc1', name: 't1', content: 'r1' },
      { role: 'user', content: 'Next turn' },
    ];
    const result = toAnthropicMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1]).toEqual({ role: 'user', content: 'Next turn' });
  });

  it('flushes pending tool results at end of messages array', () => {
    const msgs: AgentMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 't', arguments: {} }] },
      { role: 'tool', toolCallId: 'tc1', name: 't', content: 'done' },
    ];
    const result = toAnthropicMessages(msgs);
    // Last message should be the flushed tool results
    const last = result[result.length - 1];
    expect(last.role).toBe('user');
    const content = last.content as any[];
    expect(content[0].type).toBe('tool_result');
  });

  it('converts tool result with object content', () => {
    const msgs: AgentMessage[] = [{ role: 'tool', toolCallId: 'tc1', name: 't', content: { x: 1 } }];
    const result = toAnthropicMessages(msgs);
    const content = result[0].content as any[];
    expect(content[0].content).toBe('{"x":1}');
  });

  it('handles a complete multi-turn conversation', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: 'A', toolCalls: [{ id: 'c1', name: 'f', arguments: {} }] },
      { role: 'tool', toolCallId: 'c1', name: 'f', content: 'result' },
      { role: 'assistant', content: 'Final' },
    ];
    const result = toAnthropicMessages(msgs);
    expect(result).toHaveLength(4);
  });

  it('silently skips messages with an unknown role', () => {
    // Covers the false branch after `else if (msg.role === 'assistant')` (line 75 in anthropic.ts)
    const msgs = [{ role: 'system', content: 'You are helpful' }] as unknown as AgentMessage[];
    const result = toAnthropicMessages(msgs);
    expect(result).toHaveLength(0);
  });
});

// ── toGeminiMessages ──────────────────────────────────────────────────────────

describe('toGeminiMessages', () => {
  it('converts a simple user message', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: 'Hello' }];
    const result = toGeminiMessages(msgs);
    expect(result).toEqual([{ role: 'user', parts: [{ text: 'Hello' }] }]);
  });

  it('converts a user message with empty content', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '' }];
    const result = toGeminiMessages(msgs);
    expect(result[0].parts).toHaveLength(0);
  });

  it('converts a user message with URL attachment', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: 'Look', attachments: [urlImg] }];
    const result = toGeminiMessages(msgs);
    const parts = result[0].parts as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ text: 'Look' });
    expect(parts[1]).toEqual({ fileData: { mimeType: 'image/png', fileUri: urlImg.url } });
  });

  it('infers webp mimeType from .webp URL extension', () => {
    const webp: UrlAttachment = { source: 'url', kind: 'image', url: 'https://example.com/photo.webp' };
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [webp] }];
    const parts = toGeminiMessages(msgs)[0].parts as any[];
    expect(parts[0]).toMatchObject({ fileData: { mimeType: 'image/webp' } });
  });

  it('infers gif mimeType from .gif URL extension', () => {
    const gif: UrlAttachment = { source: 'url', kind: 'image', url: 'https://example.com/anim.gif' };
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [gif] }];
    const parts = toGeminiMessages(msgs)[0].parts as any[];
    expect(parts[0]).toMatchObject({ fileData: { mimeType: 'image/gif' } });
  });

  it('falls back to image/jpeg for unrecognised URL extension', () => {
    const unknown: UrlAttachment = { source: 'url', kind: 'image', url: 'https://cdn.example.com/photo?v=1' };
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [unknown] }];
    const parts = toGeminiMessages(msgs)[0].parts as any[];
    expect(parts[0]).toMatchObject({ fileData: { mimeType: 'image/jpeg' } });
  });

  it('converts a user message with data attachment', () => {
    const msgs: AgentMessage[] = [{ role: 'user', content: '', attachments: [dataImg] }];
    const result = toGeminiMessages(msgs);
    const parts = result[0].parts as any[];
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: 'abc123' } });
  });

  it('converts an assistant message using role "model"', () => {
    const msgs: AgentMessage[] = [{ role: 'assistant', content: 'Hi' }];
    const result = toGeminiMessages(msgs);
    expect(result[0].role).toBe('model');
    expect(result[0].parts).toEqual([{ text: 'Hi' }]);
  });

  it('converts an assistant message with empty content', () => {
    const msgs: AgentMessage[] = [{ role: 'assistant', content: '' }];
    const result = toGeminiMessages(msgs);
    expect(result[0].parts).toHaveLength(0);
  });

  it('converts an assistant message with tool calls', () => {
    const msgs: AgentMessage[] = [{
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }],
    }];
    const result = toGeminiMessages(msgs);
    const parts = result[0].parts as any[];
    expect(parts[0]).toEqual({ functionCall: { name: 'search', args: { q: 'test' } } });
  });

  it('converts an assistant message with attachments', () => {
    const msgs: AgentMessage[] = [{ role: 'assistant', content: 'image', attachments: [dataImg] }];
    const result = toGeminiMessages(msgs);
    const parts = result[0].parts as any[];
    expect(parts.some((p: any) => p.inlineData)).toBe(true);
  });

  it('merges consecutive tool results into a single user message', () => {
    const msgs: AgentMessage[] = [
      { role: 'tool', toolCallId: 'tc1', name: 't1', content: 'r1' },
      { role: 'tool', toolCallId: 'tc2', name: 't2', content: 'r2' },
    ];
    const result = toGeminiMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    const parts = result[0].parts as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ functionResponse: { name: 't1' } });
    expect(parts[1]).toMatchObject({ functionResponse: { name: 't2' } });
  });

  it('flushes tool results when a non-tool message follows', () => {
    const msgs: AgentMessage[] = [
      { role: 'tool', toolCallId: 'tc1', name: 't1', content: 'r1' },
      { role: 'user', content: 'Next' },
    ];
    const result = toGeminiMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1]).toEqual({ role: 'user', parts: [{ text: 'Next' }] });
  });

  it('flushes pending tool results at end of messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 't', arguments: {} }] },
      { role: 'tool', toolCallId: 'tc1', name: 't', content: 'done' },
    ];
    const result = toGeminiMessages(msgs);
    const last = result[result.length - 1];
    expect(last.role).toBe('user');
    const parts = last.parts as any[];
    expect(parts[0]).toMatchObject({ functionResponse: { name: 't' } });
  });

  it('handles a full multi-turn conversation', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'f', arguments: {} }] },
      { role: 'tool', toolCallId: 'c1', name: 'f', content: 'result' },
      { role: 'assistant', content: 'Final answer' },
    ];
    const result = toGeminiMessages(msgs);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('model');
    expect(result[2].role).toBe('user'); // flushed tool results
    expect(result[3].role).toBe('model');
  });

  it('silently skips messages with an unknown role', () => {
    // Covers the `else if (msg.role === 'assistant')` false branch (line 56 in gemini.ts)
    const msgs = [{ role: 'system', content: 'You are helpful' }] as unknown as AgentMessage[];
    const result = toGeminiMessages(msgs);
    expect(result).toHaveLength(0);
  });
});
