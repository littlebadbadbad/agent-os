/**
 * Shared OpenAI-compatible utilities used by all provider modules.
 *
 * - toOAIMessages  — convert SDK AgentMessage[] to the OAI wire format
 * - readSSEStream  — parse an OAI-compatible SSE response body
 * - assembledToToolCall — turn an assembled partial tool-call into a ToolCall
 * - extractThinking — strip <think>…</think> from raw content (Qwen)
 */

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. ' +
  'Always use tools when the user\'s request requires them. ' +
  'Be concise and respond in the same language as the user.';

// ── Vision capability ────────────────────────────────────────────────────────

/**
 * Return `true` when a model is known to accept `image_url` content parts.
 *
 * Uses a conservative allowlist: any model not matched here has its image
 * attachments degraded to text notices rather than risking a 400 error from
 * providers that reject multimodal content on text-only models.
 *
 * Update this list as new vision-capable models become available.
 */
export function supportsVision(model) {
  if (!model) return false;
  const m = model.toLowerCase();
  return (
    // ── OpenAI ──────────────────────────────────────────────────────────────
    // gpt-4o family (gpt-4o, gpt-4o-mini, gpt-4o-2024-*)
    // gpt-4.1 family (gpt-4.1, gpt-4.1-mini, gpt-4.1-nano)
    /^gpt-4[o.]/.test(m) ||
    // gpt-4-turbo (older GPT-4 with vision)
    /^gpt-4-turbo/.test(m) ||
    // gpt-5 family (gpt-5, gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3, ...)
    /^gpt-5/.test(m) ||
    // o-series reasoning models: o1, o1-mini, o1-preview, o3, o3-mini, o4-mini, o4-pro
    // Pattern: o followed by 1, 3, or 4, then non-digit or end-of-string
    /^o[134](?:[^0-9]|$)/.test(m) ||

    // ── DeepSeek ────────────────────────────────────────────────────────────
    // VL series (legacy safety net — no longer on the official API as of 2026)
    /^deepseek-vl/.test(m) ||

    // ── Qwen (Alibaba / Aliyun) ─────────────────────────────────────────────
    // Legacy: qwen-vl-* and qvq-* series
    /^qwen-vl/.test(m) ||
    /^qvq-/.test(m) ||
    // qwen3-vl series (qwen3-vl-plus, qwen3-vl-flash)
    /^qwen3-vl/.test(m) ||
    // qwen3.5 family — all listed models support image + video input
    /^qwen3\.5/.test(m) ||
    // qwen3.6 family — all listed models support image + video input
    /^qwen3\.6/.test(m) ||

    // ── Doubao (ByteDance / Volcengine) ─────────────────────────────────────
    // All doubao-seed-* models carry "多模态理解" capability
    /^doubao-seed-/.test(m) ||
    // Legacy dedicated vision models
    /^doubao-vision/.test(m) ||
    /^doubao-1-5-vision/.test(m) ||

    // ── GLM (Zhipu AI) ──────────────────────────────────────────────────────
    // Vision models always have a literal 'v' right after the version number:
    //   glm-4v-*, glm-4.1v-*, glm-4.5v-*, glm-4.6v-*, glm-5v-*
    // Text-only models (glm-4.5, glm-4.7, glm-5, glm-5.1, glm-5-turbo) do NOT.
    /^glm-[\d.]+v/.test(m) ||
    // AutoGLM-Phone (multimodal phone-control model)
    /^autoglm-/.test(m)
  );
}

// ── Attachment conversion ─────────────────────────────────────────────────────

/**
 * Convert a single SDK Attachment to an OpenAI content part.
 *
 * When `vision` is true and the attachment is an image, emits an `image_url`
 * part that vision-capable models can inspect.  Otherwise (non-image kinds or
 * text-only models) the attachment is surfaced as a human-readable text notice
 * so the model still learns that content was provided.
 *
 * This mirrors the frontend SDK's `attachmentToOpenAIPart` in
 * src/tools/messages/openai.ts so both paths produce identical wire output.
 */
function attachmentToOAIPart(attachment, vision) {
  if (vision) {
    if (attachment.source === 'url') {
      return { type: 'image_url', image_url: { url: attachment.url } };
    }
    if (attachment.kind === 'image') {
      return {
        type: 'image_url',
        image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
      };
    }
  }
  // Non-image attachments, or image attachments on text-only models: text notice.
  const label = attachment.source === 'data'
    ? (attachment.name ?? `${attachment.kind} file (${attachment.mimeType})`)
    : attachment.url;
  return { type: 'text', text: `[Attached ${attachment.kind}: ${label}]` };
}

/**
 * Build the `content` field for a user or tool message.
 *
 * - No attachments → plain string (keeps the wire format minimal).
 * - With attachments → array of content parts (text first, then image/notice parts).
 *
 * `vision` controls whether images are embedded as `image_url` blocks or
 * degraded to text notices (see `supportsVision`).
 *
 * Accepts `content` as either a string or a pre-built content array (the latter
 * occurs when the demo pre-converts messages via `context.toOpenAIMessages`
 * before POSTing to the backend — we must not JSON.stringify an array).
 */
function buildContent(content, attachments, vision) {
  if (!attachments?.length) {
    return typeof content === 'string' ? content : JSON.stringify(content);
  }
  const parts = [];
  if (content) {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    parts.push({ type: 'text', text });
  }
  for (const att of attachments) parts.push(attachmentToOAIPart(att, vision));
  return parts;
}

// ── Message conversion ────────────────────────────────────────────────────────

/**
 * Convert SDK AgentMessage[] to the OpenAI-compatible wire format.
 *
 * `model` is used to determine whether image attachments should be embedded as
 * `image_url` content parts or degraded to text notices (via `supportsVision`).
 * Pass the resolved model ID (i.e. after applying the provider default) so the
 * check is always accurate.
 */
export function toOAIMessages(messages, systemPrompt, model) {
  const prompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const vision = supportsVision(model);
  const oai = [{ role: 'system', content: prompt }];
  for (const m of messages) {
    if (m.role === 'user') {
      oai.push({ role: 'user', content: buildContent(m.content, m.attachments, vision) });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || null };
      // Reasoning models require reasoning_content echoed back on every turn.
      // Accept both the SDK field name (m.thinking, set by agentSession before
      // toOpenAIMessages runs) and the already-converted OAI field name
      // (m.reasoning_content, present when the demo pre-converts messages via
      // context.toOpenAIMessages before POSTing to the backend).
      // Use != null (not falsy) so that empty-string reasoning_content is still
      // echoed — DeepSeek/Doubao require the field to be present on every
      // assistant turn when the model is in thinking mode, even if it is "".
      const reasoningContent = m.thinking ?? m.reasoning_content;
      if (reasoningContent != null) msg.reasoning_content = reasoningContent;
      // Support both SDK format (toolCalls) and pre-converted OpenAI format (tool_calls)
      const calls = m.toolCalls ?? m.tool_calls;
      if (calls?.length) {
        msg.tool_calls = calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: tc.function ?? { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      oai.push(msg);
    } else if (m.role === 'tool') {
      oai.push({
        role: 'tool',
        tool_call_id: m.toolCallId ?? m.tool_call_id,
        content: buildContent(m.content, m.attachments, vision),
      });
    }
  }
  return oai;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(json) {
  try { return JSON.parse(json); }
  catch { return {}; }
}

export function assembledToToolCall(tc) {
  return { id: tc.id, name: tc.name, arguments: parseArgs(tc.argsJson) };
}

/**
 * Strip <think>…</think> reasoning from a completed response (Qwen models).
 * Returns { thinking, text } where text has the block removed.
 */
export function extractThinking(raw) {
  const match = raw.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/s);
  if (!match) return { thinking: '', text: raw.trim() };
  return { thinking: match[1].trim(), text: match[2].trim() };
}

// ── SSE stream reader ─────────────────────────────────────────────────────────

/**
 * Read an OpenAI-compatible SSE stream.
 *
 * @param {ReadableStream<Uint8Array>} body     Response body from the AI API
 * @param {(delta: string) => void}   onText    Called for each text delta
 * @param {(delta: string) => void}   onThinking Called for each thinking delta
 * @param {'tag'|'field'} thinkingMode
 *   'tag'   — Qwen: thinking wrapped in <think>…</think> inside `delta.content`
 *   'field' — Doubao/DeepSeek: thinking comes in `delta.reasoning_content`
 *
 * @returns {{ toolCalls: AssembledToolCall[], finishReason: string|null }}
 */
export async function readSSEStream(body, onText, onThinking, thinkingMode = 'field') {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  const callMap = new Map();
  let finishReason = null;
  let reportedUsage = null;

  // Stateful <think> block router used in 'tag' mode
  let inThink = false;

  function flushTagged(chunk) {
    let i = 0;
    while (i < chunk.length) {
      if (!inThink) {
        const start = chunk.indexOf('<think>', i);
        if (start === -1) { onText(chunk.slice(i)); break; }
        if (start > i) onText(chunk.slice(i, start));
        inThink = true;
        i = start + 7;
      } else {
        const end = chunk.indexOf('</think>', i);
        if (end === -1) { onThinking(chunk.slice(i)); i = chunk.length; break; }
        onThinking(chunk.slice(i, end));
        inThink = false;
        i = end + 8;
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;

        let chunk;
        try { chunk = JSON.parse(raw); } catch { continue; }

        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        // Capture usage — sent either at top-level (stream_options) or on the last chunk
        if (chunk.usage && chunk.usage.total_tokens != null) {
          reportedUsage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
        }

        const delta = choice?.delta;
        if (!delta) continue;

        if (thinkingMode === 'tag') {
          if (typeof delta.content === 'string' && delta.content) flushTagged(delta.content);
        } else {
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) onThinking(delta.reasoning_content);
          if (typeof delta.content === 'string' && delta.content) onText(delta.content);
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!callMap.has(idx)) callMap.set(idx, { id: '', name: '', argsJson: '' });
            const entry = callMap.get(idx);
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.argsJson += tc.function.arguments;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    toolCalls: [...callMap.entries()].sort(([a], [b]) => a - b).map(([, tc]) => tc),
    finishReason,
    usage: reportedUsage,
  };
}
