/**
 * backend/lib/anthropic.js — Anthropic Messages API utilities
 *
 * Converts SDK AgentMessage[] to the Anthropic wire format.
 * Handles:
 * - System prompt as top-level 'system' field
 * - User messages with image attachments (base64 with media_type)
 * - Tool results
 * - Tool_use content blocks for tool calls
 * - Thinking extraction from text
 *
 * Anthropic API: POST /v1/messages
 * Reference: https://docs.anthropic.com/en/api/messages
 */

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. ' +
  'Always use tools when the user\'s request requires them. ' +
  'Be concise and respond in the same language as the user.';

// ── Attachment conversion ─────────────────────────────────────────────────────

/**
 * Convert a single SDK Attachment to an Anthropic content part.
 *
 * Anthropic handles images via `source` blocks with base64 data.
 * Documents are sent as text notices (Anthropic doesn't support document
 * vision in the same way as OpenAI).
 *
 * @param {object} attachment — SDK attachment
 * @param {boolean} vision — whether the model supports vision
 * @returns {object} Anthropic content block
 */
function attachmentToAnthropicBlock(attachment, vision) {
  if (vision && attachment.kind === 'image') {
    const source = attachment.source === 'url'
      ? { type: 'url', url: attachment.url }
      : { type: 'base64', media_type: attachment.mimeType, data: attachment.data };
    return { type: 'image', source };
  }

  const label = attachment.source === 'data'
    ? (attachment.name ?? `${attachment.kind} file (${attachment.mimeType})`)
    : attachment.url;
  return { type: 'text', text: `[Attached ${attachment.kind}: ${label}]` };
}

/**
 * Build Anthropic content blocks from text + attachments.
 *
 * @param {string|Array} content
 * @param {Array} [attachments]
 * @param {boolean} vision
 * @returns {Array} Anthropic content blocks
 */
function buildContent(content, attachments, vision) {
  const blocks = [];
  if (content) {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    blocks.push({ type: 'text', text });
  }
  if (attachments?.length) {
    for (const att of attachments) {
      blocks.push(attachmentToAnthropicBlock(att, vision));
    }
  }
  return blocks;
}

// ── Tool format conversion ────────────────────────────────────────────────────

/**
 * Convert SDK ToolDescriptor[] to Anthropic tool format.
 *
 * Anthropic uses: { name, description, input_schema }
 * vs OpenAI: { type: 'function', function: { name, description, parameters } }
 *
 * @param {Array} tools — SDK ToolDescriptor[] or pre-formatted OAI tools
 * @returns {Array} Anthropic-formatted tools
 */
export function toAnthropicTools(tools) {
  if (!tools?.length) return [];
  // If already in Anthropic format (has input_schema), pass through
  if (tools[0]?.input_schema) return tools;
  // Convert from SDK format or OAI format
  return tools.map((t) => {
    const fn = t.function ?? t;
    return {
      name: fn.name,
      description: fn.description ?? '',
      input_schema: fn.parameters ?? fn.input_schema ?? {},
    };
  });
}

/**
 * Determine if a model ID suggests vision capability.
 * Anthropic models: claude-3-5-sonnet, claude-3-opus, claude-3-haiku, etc.
 * All Claude 3+ models support vision.
 *
 * @param {string} model
 * @returns {boolean}
 */
export function supportsAnthropicVision(model) {
  if (!model) return false;
  const m = model.toLowerCase();
  // All Claude 3.x models support vision
  return /^claude/.test(m);
}

// ── Message conversion ────────────────────────────────────────────────────────

/**
 * Convert SDK AgentMessage[] to Anthropic Messages API wire format.
 *
 * Anthropic format differences from OpenAI:
 * - System prompt is a top-level 'system' field (array of text blocks)
 * - Messages alternate between 'user' and 'assistant' roles only
 * - No 'system' message role
 * - Tool results use 'tool_result' content blocks
 * - Tool calls use 'tool_use' content blocks with 'id' and 'input'
 * - Images use 'image' type with source object
 *
 * @param {Array}  messages — SDK AgentMessage[]
 * @param {string} [systemPrompt]
 * @param {string} [model] — used for vision detection
 * @returns {{ system: Array, messages: Array }}
 */
export function toAnthropicMessages(messages, systemPrompt, model) {
  const vision = supportsAnthropicVision(model);
  const prompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const anthroMessages = [];

  for (const m of messages) {
    if (m.role === 'user') {
      anthroMessages.push({
        role: 'user',
        content: buildContent(m.content, m.attachments, vision),
      });
    } else if (m.role === 'assistant') {
      const content = [];
      if (m.content) {
        content.push({ type: 'text', text: m.content });
      }
      // Tool calls → tool_use blocks
      const calls = m.toolCalls ?? m.tool_calls;
      if (calls?.length) {
        for (const tc of calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name ?? tc.function?.name,
            input: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : (tc.arguments ?? {}),
          });
        }
      }
      anthroMessages.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      // Tool results → tool_result content block inside a user message
      const toolContent = { type: 'tool_result', tool_use_id: m.toolCallId ?? m.tool_call_id };
      if (typeof m.content === 'string') {
        toolContent.content = m.content;
      } else {
        toolContent.content = JSON.stringify(m.content);
      }
      anthroMessages.push({ role: 'user', content: [toolContent] });
    }
  }

  return {
    system: [{ type: 'text', text: prompt }],
    messages: anthroMessages,
  };
}

// ── Response parsing ──────────────────────────────────────────────────────────

/**
 * Parse an Anthropic Messages API response into SDK format.
 *
 * @param {object} data — parsed JSON response from Anthropic API
 * @returns {{ text: string, thinking?: string, toolCalls?: Array, usage?: object }}
 */
export function parseAnthropicResponse(data) {
  let text = '';
  const toolCalls = [];
  let thinking = undefined;

  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'text') {
        // Anthropic may include thinking in text with  tags
        const extracted = extractThinkingFromAnthropic(block.text ?? '');
        if (extracted.thinking) thinking = extracted.thinking;
        text += extracted.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input ?? {},
        });
      }
    }
  }

  text = text.trim();

  // Anthropic may have top-level thinking field
  if (data.thinking?.text) {
    thinking = data.thinking.text;
  }

  return {
    text: text || undefined,
    thinking: thinking || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/**
 * Simple thinking extraction from Anthropic text (using  tags convention).
 * Some Anthropic models wrap thinking in  tags.
 *
 * @param {string} raw
 * @returns {{ thinking: string|null, text: string }}
 */
function extractThinkingFromAnthropic(raw) {
  const match = raw.match(/^<thinking>([\s\S]*?)<\/thinking>([\s\S]*)$/);
  if (!match) return { thinking: null, text: raw };
  return { thinking: match[1].trim(), text: match[2].trim() };
}
