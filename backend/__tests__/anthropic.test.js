/**
 * Tests for backend/lib/anthropic.js — Anthropic Messages API utilities
 *
 * Covers: toAnthropicMessages (user/assistant/tool messages, attachments, vision),
 * toAnthropicTools, supportsAnthropicVision, parseAnthropicResponse.
 */

import { describe, it, expect } from 'vitest';
import { toAnthropicMessages, toAnthropicTools, supportsAnthropicVision, parseAnthropicResponse } from '../lib/anthropic.js';

describe('toAnthropicMessages', () => {
  it('converts a simple user message', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const result = toAnthropicMessages(messages, 'You are helpful.', 'claude-3.5-sonnet');
    expect(result.system).toEqual([{ type: 'text', text: 'You are helpful.' }]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Hello' }] });
  });

  it('converts assistant message with content', () => {
    const messages = [{ role: 'assistant', content: 'Hello back!' }];
    const result = toAnthropicMessages(messages, '', 'claude-3.5-sonnet');
    expect(result.messages[0].role).toBe('assistant');
    expect(result.messages[0].content).toEqual([{ type: 'text', text: 'Hello back!' }]);
  });

  it('converts assistant message with tool calls', () => {
    const messages = [{
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'get_weather', arguments: { city: 'Beijing' } }],
    }];
    const result = toAnthropicMessages(messages, '', 'claude-3.5-sonnet');
    // Empty content doesn't produce a text block; only tool_use is added
    expect(result.messages[0].content).toHaveLength(1);
    expect(result.messages[0].content[0]).toEqual({
      type: 'tool_use',
      id: 'tc-1',
      name: 'get_weather',
      input: { city: 'Beijing' },
    });
  });

  it('converts tool result messages', () => {
    const messages = [{ role: 'tool', toolCallId: 'tc-1', content: 'Sunny' }];
    const result = toAnthropicMessages(messages, '', 'claude-3.5-sonnet');
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toEqual([{
      type: 'tool_result',
      tool_use_id: 'tc-1',
      content: 'Sunny',
    }]);
  });

  it('converts image attachments with vision', () => {
    const messages = [{
      role: 'user',
      content: 'What is this?',
      attachments: [{ source: 'data', kind: 'image', mimeType: 'image/png', data: 'base64data' }],
    }];
    const result = toAnthropicMessages(messages, '', 'claude-3.5-sonnet');
    expect(result.messages[0].content).toHaveLength(2);
    expect(result.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'base64data' },
    });
  });

  it('converts URL image attachments', () => {
    const messages = [{
      role: 'user',
      content: 'See this',
      attachments: [{ source: 'url', kind: 'image', url: 'https://example.com/img.png' }],
    }];
    const result = toAnthropicMessages(messages, '', 'claude-3.5-sonnet');
    expect(result.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/img.png' },
    });
  });

  it('degrades non-image attachments to text notices', () => {
    const messages = [{
      role: 'user',
      content: 'Read this',
      attachments: [{ source: 'data', kind: 'document', mimeType: 'application/pdf', data: 'pdfdata', name: 'doc.pdf' }],
    }];
    const result = toAnthropicMessages(messages, '', 'claude-3.5-sonnet');
    expect(result.messages[0].content[1].type).toBe('text');
    expect(result.messages[0].content[1].text).toContain('doc.pdf');
  });

  it('supports both toolCalls and tool_calls field names', () => {
    const messages = [{
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'tc-2', name: 'search', arguments: { q: 'test' } }],
    }];
    const result = toAnthropicMessages(messages, '', 'claude-3.5-sonnet');
    expect(result.messages[0].content[0].type).toBe('tool_use');
  });

  it('uses default system prompt when none provided', () => {
    const messages = [{ role: 'user', content: 'Hi' }];
    const result = toAnthropicMessages(messages, undefined, 'claude-3.5-sonnet');
    expect(result.system[0].text).toContain('helpful');
  });
});

describe('toAnthropicTools', () => {
  it('converts SDK tool format', () => {
    const tools = [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } }];
    const result = toAnthropicTools(tools);
    expect(result).toEqual([{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object' } }]);
  });

  it('converts OAI tool format', () => {
    const tools = [{ type: 'function', function: { name: 'search', description: 'Search', parameters: { type: 'object' } } }];
    const result = toAnthropicTools(tools);
    expect(result).toEqual([{ name: 'search', description: 'Search', input_schema: { type: 'object' } }]);
  });

  it('passes through already-formatted tools', () => {
    const tools = [{ name: 'test', description: '', input_schema: { type: 'object' } }];
    const result = toAnthropicTools(tools);
    expect(result).toEqual(tools);
  });

  it('returns empty array for no tools', () => {
    expect(toAnthropicTools([])).toEqual([]);
    expect(toAnthropicTools(null)).toEqual([]);
    expect(toAnthropicTools(undefined)).toEqual([]);
  });
});

describe('supportsAnthropicVision', () => {
  it('returns true for claude models', () => {
    expect(supportsAnthropicVision('claude-3.5-sonnet')).toBe(true);
    expect(supportsAnthropicVision('claude-3-opus')).toBe(true);
    expect(supportsAnthropicVision('claude-3-haiku')).toBe(true);
    expect(supportsAnthropicVision('claude-4')).toBe(true);
  });

  it('returns false for non-claude models', () => {
    expect(supportsAnthropicVision('gpt-4')).toBe(false);
    expect(supportsAnthropicVision('deepseek-v4')).toBe(false);
    expect(supportsAnthropicVision('')).toBe(false);
    expect(supportsAnthropicVision(null)).toBe(false);
  });
});

describe('parseAnthropicResponse', () => {
  it('parses text content', () => {
    const data = { content: [{ type: 'text', text: 'Hello!' }] };
    const result = parseAnthropicResponse(data);
    expect(result.text).toBe('Hello!');
    expect(result.toolCalls).toBeUndefined();
  });

  it('parses tool_use blocks', () => {
    const data = {
      content: [
        { type: 'text', text: 'Let me search...' },
        { type: 'tool_use', id: 'tu-1', name: 'search', input: { q: 'weather' } },
      ],
    };
    const result = parseAnthropicResponse(data);
    expect(result.text).toBe('Let me search...');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('search');
    expect(result.toolCalls[0].arguments).toEqual({ q: 'weather' });
  });

  it('extracts thinking from top-level thinking field', () => {
    const data = { content: [{ type: 'text', text: 'Answer' }], thinking: { text: 'My reasoning' } };
    const result = parseAnthropicResponse(data);
    expect(result.text).toBe('Answer');
    expect(result.thinking).toBe('My reasoning');
  });

  it('returns undefined title when no text', () => {
    const result = parseAnthropicResponse({ content: [] });
    expect(result.text).toBeUndefined();
  });
});
