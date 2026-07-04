/**
 * Tests for backend/lib/oai.js
 *
 * Covers:
 *   toOAIMessages     — user / assistant / tool message conversion; system prompt prepended
 *   extractThinking   — strips <think>…</think> from raw content
 *   assembledToToolCall — maps assembled partial to a ToolCall; handles bad JSON args
 *   readSSEStream     — field mode (reasoning_content), tag mode (<think>), tool-call assembly
 */

import { describe, it, expect, vi } from 'vitest';
import { toOAIMessages, extractThinking, assembledToToolCall, readSSEStream, supportsVision } from '../lib/oai.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

/**
 * Build a ReadableStream whose chunks are SSE lines joined by newlines.
 * Each string in `lines` is emitted as a separate chunk.
 */
function makeSSEStream(...lines) {
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    },
  });
}

/** Wrap a JSON payload as a single SSE data line. */
function sseData(obj) {
  return `data: ${JSON.stringify(obj)}`;
}

/** Build a minimal OAI streaming chunk (choices[0].delta). */
function chunk(delta, finishReason = null) {
  return { choices: [{ delta, finish_reason: finishReason }] };
}

// ── toOAIMessages ─────────────────────────────────────────────────────────────

describe('toOAIMessages', () => {
  it('always prepends a system message', () => {
    const oai = toOAIMessages([]);
    expect(oai[0].role).toBe('system');
    expect(typeof oai[0].content).toBe('string');
    expect(oai[0].content.length).toBeGreaterThan(0);
  });

  it('maps a user message correctly', () => {
    const oai = toOAIMessages([{ role: 'user', content: 'Hello' }]);
    expect(oai[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('maps a plain assistant message correctly', () => {
    const oai = toOAIMessages([{ role: 'assistant', content: 'Hi there' }]);
    expect(oai[1]).toMatchObject({ role: 'assistant', content: 'Hi there' });
    expect(oai[1].tool_calls).toBeUndefined();
    expect(oai[1].reasoning_content).toBeUndefined();
  });

  it('echoes non-empty thinking as reasoning_content', () => {
    const msg = { role: 'assistant', content: 'Answer', thinking: 'some reasoning' };
    const oai = toOAIMessages([msg]);
    expect(oai[1].reasoning_content).toBe('some reasoning');
  });

  it('echoes empty-string thinking as reasoning_content (not dropped)', () => {
    // Thinking models (DeepSeek, Doubao) require reasoning_content echoed back even
    // when the model produced an empty string — dropping it causes a 400 error.
    const msg = { role: 'assistant', content: 'Answer', thinking: '' };
    const oai = toOAIMessages([msg]);
    expect(oai[1].reasoning_content).toBe('');
  });

  it('echoes reasoning_content field when thinking is absent but reasoning_content is set', () => {
    const msg = { role: 'assistant', content: 'Answer', reasoning_content: 'pre-converted' };
    const oai = toOAIMessages([msg]);
    expect(oai[1].reasoning_content).toBe('pre-converted');
  });

  it('echoes empty-string reasoning_content without dropping it', () => {
    const msg = { role: 'assistant', content: 'Answer', reasoning_content: '' };
    const oai = toOAIMessages([msg]);
    expect(oai[1].reasoning_content).toBe('');
  });

  it('does NOT add reasoning_content when both thinking and reasoning_content are absent', () => {
    const msg = { role: 'assistant', content: 'No thinking here' };
    const oai = toOAIMessages([msg]);
    expect('reasoning_content' in oai[1]).toBe(false);
  });

  it('maps an assistant message with tool calls', () => {
    const msg = {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'tc1', name: 'get_weather', arguments: { city: 'Tokyo' } }],
    };
    const oai = toOAIMessages([msg]);
    expect(oai[1].role).toBe('assistant');
    expect(oai[1].content).toBeNull();
    expect(oai[1].tool_calls).toHaveLength(1);
    expect(oai[1].tool_calls[0]).toMatchObject({
      id: 'tc1',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
    });
  });

  it('maps a tool result message correctly', () => {
    const msg = { role: 'tool', toolCallId: 'tc1', content: 'sunny' };
    const oai = toOAIMessages([msg]);
    expect(oai[1]).toEqual({ role: 'tool', tool_call_id: 'tc1', content: 'sunny' });
  });

  it('JSON-stringifies non-string tool content', () => {
    const msg = { role: 'tool', toolCallId: 'tc2', content: { temp: 20 } };
    const oai = toOAIMessages([msg]);
    expect(oai[1].content).toBe('{"temp":20}');
  });

  it('preserves message order in multi-turn conversations', () => {
    const msgs = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
    ];
    const oai = toOAIMessages(msgs);
    // index 0 is system; 1-3 are the turns
    expect(oai[1].content).toBe('Q1');
    expect(oai[2].content).toBe('A1');
    expect(oai[3].content).toBe('Q2');
  });
});

// ── supportsVision ────────────────────────────────────────────────────────────

describe('supportsVision', () => {
  // ── OpenAI ─────────────────────────────────────────────────────────────────
  it('returns true for gpt-4o', () => expect(supportsVision('gpt-4o')).toBe(true));
  it('returns true for gpt-4o-mini', () => expect(supportsVision('gpt-4o-mini')).toBe(true));
  it('returns true for gpt-4.1-mini', () => expect(supportsVision('gpt-4.1-mini')).toBe(true));
  it('returns true for gpt-4-turbo', () => expect(supportsVision('gpt-4-turbo')).toBe(true));
  it('returns true for gpt-5', () => expect(supportsVision('gpt-5')).toBe(true));
  it('returns true for gpt-5.5', () => expect(supportsVision('gpt-5.5')).toBe(true));
  it('returns true for gpt-5.4-mini', () => expect(supportsVision('gpt-5.4-mini')).toBe(true));
  it('returns true for o1-mini', () => expect(supportsVision('o1-mini')).toBe(true));
  it('returns true for o3-mini', () => expect(supportsVision('o3-mini')).toBe(true));
  it('returns true for o4-mini', () => expect(supportsVision('o4-mini')).toBe(true));
  // ── DeepSeek ───────────────────────────────────────────────────────────────
  it('returns true for deepseek-vl-7b-chat (legacy)', () => expect(supportsVision('deepseek-vl-7b-chat')).toBe(true));
  it('returns false for deepseek-v4-flash (text-only)', () => expect(supportsVision('deepseek-v4-flash')).toBe(false));
  it('returns false for deepseek-v4-pro (text-only)', () => expect(supportsVision('deepseek-v4-pro')).toBe(false));
  it('returns false for deepseek-chat (text-only)', () => expect(supportsVision('deepseek-chat')).toBe(false));
  // ── Qwen ───────────────────────────────────────────────────────────────────
  it('returns true for qwen-vl-plus', () => expect(supportsVision('qwen-vl-plus')).toBe(true));
  it('returns true for qvq-72b-preview', () => expect(supportsVision('qvq-72b-preview')).toBe(true));
  it('returns true for qwen3-vl-plus', () => expect(supportsVision('qwen3-vl-plus')).toBe(true));
  it('returns true for qwen3-vl-flash', () => expect(supportsVision('qwen3-vl-flash')).toBe(true));
  it('returns true for qwen3.5-plus', () => expect(supportsVision('qwen3.5-plus')).toBe(true));
  it('returns true for qwen3.5-flash', () => expect(supportsVision('qwen3.5-flash')).toBe(true));
  it('returns true for qwen3.5-omni-plus', () => expect(supportsVision('qwen3.5-omni-plus')).toBe(true));
  it('returns true for qwen3.6-plus', () => expect(supportsVision('qwen3.6-plus')).toBe(true));
  it('returns true for qwen3.6-flash', () => expect(supportsVision('qwen3.6-flash')).toBe(true));
  // ── Doubao ─────────────────────────────────────────────────────────────────
  it('returns true for doubao-vision-lite-32k (legacy)', () => expect(supportsVision('doubao-vision-lite-32k')).toBe(true));
  it('returns true for doubao-1-5-vision-pro-32k-250115', () => expect(supportsVision('doubao-1-5-vision-pro-32k-250115')).toBe(true));
  it('returns true for doubao-seed-2-0-pro-260215', () => expect(supportsVision('doubao-seed-2-0-pro-260215')).toBe(true));
  it('returns true for doubao-seed-2-0-lite-260428', () => expect(supportsVision('doubao-seed-2-0-lite-260428')).toBe(true));
  it('returns true for doubao-seed-1-6-vision-250815', () => expect(supportsVision('doubao-seed-1-6-vision-250815')).toBe(true));
  it('returns false for doubao-1-5-pro-32k-250115 (text-only)', () => expect(supportsVision('doubao-1-5-pro-32k-250115')).toBe(false));
  // ── GLM ────────────────────────────────────────────────────────────────────
  // Vision models: 'v' appears directly after the version number
  it('returns true for glm-4v-plus', () => expect(supportsVision('glm-4v-plus')).toBe(true));
  it('returns true for glm-4v-flash', () => expect(supportsVision('glm-4v-flash')).toBe(true));
  it('returns true for glm-4.1v-thinking-flash', () => expect(supportsVision('glm-4.1v-thinking-flash')).toBe(true));
  it('returns true for glm-4.6v', () => expect(supportsVision('glm-4.6v')).toBe(true));
  it('returns true for glm-4.6v-flash', () => expect(supportsVision('glm-4.6v-flash')).toBe(true));
  it('returns true for glm-4.6v-flashx', () => expect(supportsVision('glm-4.6v-flashx')).toBe(true));
  it('returns true for glm-5v-turbo', () => expect(supportsVision('glm-5v-turbo')).toBe(true));
  it('returns true for autoglm-phone', () => expect(supportsVision('autoglm-phone')).toBe(true));
  // Text-only models: no 'v' after the version number
  it('returns false for glm-4.5-air (text-only)', () => expect(supportsVision('glm-4.5-air')).toBe(false));
  it('returns false for glm-4.7-flash (text-only)', () => expect(supportsVision('glm-4.7-flash')).toBe(false));
  it('returns false for glm-5 (text-only)', () => expect(supportsVision('glm-5')).toBe(false));
  it('returns false for glm-5.1 (text-only)', () => expect(supportsVision('glm-5.1')).toBe(false));
  it('returns false for glm-5-turbo (text-only)', () => expect(supportsVision('glm-5-turbo')).toBe(false));
  it('returns false for glm-4-air (text-only GLM-4 series)', () => expect(supportsVision('glm-4-air')).toBe(false));
  it('returns false for glm-4-plus (text-only GLM-4 series)', () => expect(supportsVision('glm-4-plus')).toBe(false));
  // ── Edge cases ─────────────────────────────────────────────────────────────
  it('returns false for null/undefined', () => {
    expect(supportsVision(null)).toBe(false);
    expect(supportsVision(undefined)).toBe(false);
  });
  it('returns false for empty string', () => expect(supportsVision('')).toBe(false));
});

// ── toOAIMessages — multimodal (attachments) ──────────────────────────────────

describe('toOAIMessages – attachments', () => {
  // ── vision-capable model ───────────────────────────────────────────────────

  it('user message with data image (vision model) → multipart content array', () => {
    const msg = {
      role: 'user',
      content: 'Look at this',
      attachments: [
        { source: 'data', kind: 'image', mimeType: 'image/png', data: 'abc123==' },
      ],
    };
    const oai = toOAIMessages([msg], undefined, 'gpt-4o');
    const content = oai[1].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: 'Look at this' });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123==' },
    });
  });

  it('user message with URL image (vision model) → image_url with the original url', () => {
    const msg = {
      role: 'user',
      content: 'What is this?',
      attachments: [
        { source: 'url', kind: 'image', url: 'https://example.com/photo.jpg' },
      ],
    };
    const oai = toOAIMessages([msg], undefined, 'gpt-4o');
    const content = oai[1].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: 'What is this?' });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/photo.jpg' },
    });
  });

  it('user message with multiple images (vision model) → all parts in order', () => {
    const msg = {
      role: 'user',
      content: 'Compare',
      attachments: [
        { source: 'data', kind: 'image', mimeType: 'image/jpeg', data: 'img1==' },
        { source: 'data', kind: 'image', mimeType: 'image/jpeg', data: 'img2==' },
      ],
    };
    const oai = toOAIMessages([msg], undefined, 'gpt-4o');
    const content = oai[1].content;
    expect(content).toHaveLength(3); // text + 2 images
    expect(content[0].type).toBe('text');
    expect(content[1].image_url.url).toContain('img1==');
    expect(content[2].image_url.url).toContain('img2==');
  });

  it('tool message with image (vision model) → multipart content array', () => {
    const msg = {
      role: 'tool',
      toolCallId: 'tc1',
      content: 'Screenshot taken',
      attachments: [
        { source: 'data', kind: 'image', mimeType: 'image/jpeg', data: 'screenshotdata==' },
      ],
    };
    const oai = toOAIMessages([msg], undefined, 'gpt-4o');
    const content = oai[1].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: 'Screenshot taken' });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,screenshotdata==' },
    });
  });

  // ── text-only model (image downgrade) ─────────────────────────────────────

  it('user message with image (text-only model) → text notice, no image_url', () => {
    const msg = {
      role: 'user',
      content: 'Look at this',
      attachments: [
        { source: 'data', kind: 'image', mimeType: 'image/png', data: 'abc123==', name: 'photo.png' },
      ],
    };
    const oai = toOAIMessages([msg], undefined, 'deepseek-v4-flash');
    const content = oai[1].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.some((p) => p.type === 'image_url')).toBe(false);
    expect(content[1]).toEqual({ type: 'text', text: '[Attached image: photo.png]' });
  });

  it('user message with URL image (text-only model) → text notice with url', () => {
    const msg = {
      role: 'user',
      content: 'See',
      attachments: [
        { source: 'url', kind: 'image', url: 'https://example.com/img.jpg' },
      ],
    };
    const oai = toOAIMessages([msg], undefined, 'deepseek-chat');
    const content = oai[1].content;
    expect(content.some((p) => p.type === 'image_url')).toBe(false);
    expect(content[1]).toEqual({ type: 'text', text: '[Attached image: https://example.com/img.jpg]' });
  });

  it('user message with image, no model → images downgraded (conservative default)', () => {
    const msg = {
      role: 'user',
      content: 'Hi',
      attachments: [{ source: 'data', kind: 'image', mimeType: 'image/png', data: 'x==' }],
    };
    const oai = toOAIMessages([msg]);
    const content = oai[1].content;
    expect(content.some((p) => p.type === 'image_url')).toBe(false);
  });

  // ── non-image attachments (always text notice regardless of model) ─────────

  it('user message with named document → text notice', () => {
    const msg = {
      role: 'user',
      content: 'Read this PDF',
      attachments: [
        { source: 'data', kind: 'document', mimeType: 'application/pdf', data: 'pdfdata==', name: 'report.pdf' },
      ],
    };
    const oai = toOAIMessages([msg], undefined, 'gpt-4o');
    expect(oai[1].content[1]).toEqual({ type: 'text', text: '[Attached document: report.pdf]' });
  });

  it('user message with unnamed document → text notice using kind+mimeType', () => {
    const msg = {
      role: 'user',
      content: 'Here',
      attachments: [
        { source: 'data', kind: 'document', mimeType: 'application/pdf', data: 'pdfdata==' },
      ],
    };
    const oai = toOAIMessages([msg], undefined, 'gpt-4o');
    expect(oai[1].content[1]).toEqual({ type: 'text', text: '[Attached document: document file (application/pdf)]' });
  });

  // ── no-attachment regressions ──────────────────────────────────────────────

  it('user message without attachments → plain string content', () => {
    const oai = toOAIMessages([{ role: 'user', content: 'Hi' }]);
    expect(oai[1].content).toBe('Hi');
    expect(Array.isArray(oai[1].content)).toBe(false);
  });

  it('tool message without attachments → plain string content', () => {
    const oai = toOAIMessages([{ role: 'tool', toolCallId: 'tc2', content: 'done' }]);
    expect(oai[1].content).toBe('done');
  });

  it('tool message with object content, no attachments → JSON-stringified', () => {
    const oai = toOAIMessages([{ role: 'tool', toolCallId: 'tc3', content: { status: 'ok' } }]);
    expect(oai[1].content).toBe('{"status":"ok"}');
  });
});

// ── extractThinking ───────────────────────────────────────────────────────────

describe('extractThinking', () => {
  it('returns empty thinking and the original text when no <think> block', () => {
    const result = extractThinking('Hello world');
    expect(result).toEqual({ thinking: '', text: 'Hello world' });
  });

  it('extracts content inside <think>…</think>', () => {
    const result = extractThinking('<think>internal reasoning</think>Final answer');
    expect(result.thinking).toBe('internal reasoning');
    expect(result.text).toBe('Final answer');
  });

  it('trims whitespace from both thinking and text', () => {
    const result = extractThinking('<think>  step 1  </think>  answer  ');
    expect(result.thinking).toBe('step 1');
    expect(result.text).toBe('answer');
  });

  it('handles multi-line think blocks', () => {
    const raw = '<think>\nline1\nline2\n</think>\nresult';
    const { thinking, text } = extractThinking(raw);
    expect(thinking).toContain('line1');
    expect(thinking).toContain('line2');
    expect(text).toBe('result');
  });

  it('returns empty text when nothing follows the think block', () => {
    const { text } = extractThinking('<think>only thinking</think>');
    expect(text).toBe('');
  });
});

// ── assembledToToolCall ───────────────────────────────────────────────────────

describe('assembledToToolCall', () => {
  it('converts a valid assembled call to a ToolCall', () => {
    const tc = assembledToToolCall({ id: 'tc1', name: 'add', argsJson: '{"a":1}' });
    expect(tc).toEqual({ id: 'tc1', name: 'add', arguments: { a: 1 } });
  });

  it('returns {} arguments when argsJson is invalid JSON', () => {
    const tc = assembledToToolCall({ id: 'tc2', name: 'broken', argsJson: 'not json' });
    expect(tc.arguments).toEqual({});
  });

  it('returns {} arguments when argsJson is empty', () => {
    const tc = assembledToToolCall({ id: 'tc3', name: 'empty', argsJson: '' });
    expect(tc.arguments).toEqual({});
  });
});

// ── readSSEStream — field mode ────────────────────────────────────────────────

describe('readSSEStream (field mode)', () => {
  it('collects text deltas via onText callback', async () => {
    const stream = makeSSEStream(
      sseData(chunk({ content: 'Hello' })),
      sseData(chunk({ content: ' world' })),
      'data: [DONE]',
    );
    const texts = [];
    await readSSEStream(stream, (d) => texts.push(d), () => {}, 'field');
    expect(texts.join('')).toBe('Hello world');
  });

  it('collects reasoning_content via onThinking callback', async () => {
    const stream = makeSSEStream(
      sseData(chunk({ reasoning_content: 'thinking...' })),
      sseData(chunk({ content: 'answer' })),
      'data: [DONE]',
    );
    const thoughts = [];
    const texts = [];
    await readSSEStream(stream, (d) => texts.push(d), (d) => thoughts.push(d), 'field');
    expect(thoughts.join('')).toBe('thinking...');
    expect(texts.join('')).toBe('answer');
  });

  it('assembles streamed tool calls into a list', async () => {
    const stream = makeSSEStream(
      sseData(chunk({ tool_calls: [{ index: 0, id: 'tc1', function: { name: 'add', arguments: '{"a"' } }] })),
      sseData(chunk({ tool_calls: [{ index: 0, function: { arguments: ':1}' } }] })),
      'data: [DONE]',
    );
    const { toolCalls } = await readSSEStream(stream, () => {}, () => {}, 'field');
    expect(toolCalls).toHaveLength(1);
    // readSSEStream returns raw { id, name, argsJson }; callers call assembledToToolCall themselves
    expect(toolCalls[0]).toMatchObject({ id: 'tc1', name: 'add', argsJson: '{"a":1}' });
  });

  it('assembles multiple parallel tool calls', async () => {
    const stream = makeSSEStream(
      sseData(chunk({ tool_calls: [{ index: 0, id: 'tc1', function: { name: 'f1', arguments: '{}' } }] })),
      sseData(chunk({ tool_calls: [{ index: 1, id: 'tc2', function: { name: 'f2', arguments: '{}' } }] })),
      'data: [DONE]',
    );
    const { toolCalls } = await readSSEStream(stream, () => {}, () => {}, 'field');
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((t) => t.name)).toEqual(expect.arrayContaining(['f1', 'f2']));
  });

  it('skips malformed JSON SSE lines silently', async () => {
    const stream = makeSSEStream(
      'data: {broken',
      sseData(chunk({ content: 'ok' })),
      'data: [DONE]',
    );
    const texts = [];
    await readSSEStream(stream, (d) => texts.push(d), () => {}, 'field');
    expect(texts.join('')).toBe('ok');
  });

  it('ignores lines that do not start with "data: "', async () => {
    const stream = makeSSEStream(
      'event: ping',
      ': keep-alive',
      sseData(chunk({ content: 'real' })),
      'data: [DONE]',
    );
    const texts = [];
    await readSSEStream(stream, (d) => texts.push(d), () => {}, 'field');
    expect(texts.join('')).toBe('real');
  });
});

// ── readSSEStream — tag mode (<think>) ───────────────────────────────────────

describe('readSSEStream (tag mode)', () => {
  it('routes content before <think> to onText', async () => {
    const stream = makeSSEStream(
      sseData(chunk({ content: 'Intro <think>internal</think> Outro' })),
      'data: [DONE]',
    );
    const texts = [];
    const thoughts = [];
    await readSSEStream(stream, (d) => texts.push(d), (d) => thoughts.push(d), 'tag');
    expect(texts.join('')).toBe('Intro  Outro');
    expect(thoughts.join('')).toBe('internal');
  });

  it('handles a think block that spans multiple chunks', async () => {
    const stream = makeSSEStream(
      sseData(chunk({ content: '<think>part' })),
      sseData(chunk({ content: '1</think>done' })),
      'data: [DONE]',
    );
    const texts = [];
    const thoughts = [];
    await readSSEStream(stream, (d) => texts.push(d), (d) => thoughts.push(d), 'tag');
    expect(thoughts.join('')).toBe('part1');
    expect(texts.join('')).toBe('done');
  });
});
