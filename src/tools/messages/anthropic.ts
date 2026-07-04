import type {
  AgentMessage,
  Attachment,
  DataAttachment,
  AnthropicMessage,
  AnthropicContentBlock,
} from '@agent-type';
import { isDataAttachment, isUrlAttachment } from './attachment';

function attachmentToAnthropicBlock(attachment: Attachment): AnthropicContentBlock {
  if (isUrlAttachment(attachment)) {
    return { type: 'image', source: { type: 'url', url: attachment.url } };
  }

  const a = attachment as DataAttachment;

  if (a.kind === 'image') {
    return {
      type: 'image',
      source: { type: 'base64', media_type: a.mimeType, data: a.data },
    };
  }

  if (a.kind === 'document') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: a.mimeType, data: a.data },
      ...(a.name ? { title: a.name } : {}),
    };
  }

  // Audio / video — not natively supported yet.
  const label = a.name ?? `${a.kind} file (${a.mimeType})`;
  return { type: 'text', text: `[Attached ${a.kind}: ${label}]` };
}

/**
 * Convert `AgentMessage[]` to the Anthropic Messages API `messages[]` format.
 *
 * Consecutive tool results are merged into a single `user` message with
 * multiple `tool_result` blocks, as required by the Anthropic API.
 */
export function toAnthropicMessages(messages: readonly AgentMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];
  let pendingToolResults: AnthropicContentBlock[] = [];

  function flushToolResults(): void {
    if (pendingToolResults.length > 0) {
      result.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  }

  for (const msg of messages) {
    if (msg.role === 'tool') {
      const text =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (msg.attachments && msg.attachments.length > 0) {
        // Anthropic tool_result supports an array of content blocks.
        // Put the text result first, then embed each image so the model can see it.
        const blocks: AnthropicContentBlock[] = [{ type: 'text', text }];
        for (const att of msg.attachments) blocks.push(attachmentToAnthropicBlock(att));
        pendingToolResults.push({ type: 'tool_result', tool_use_id: msg.toolCallId, content: blocks });
      } else {
        pendingToolResults.push({ type: 'tool_result', tool_use_id: msg.toolCallId, content: text });
      }
      continue;
    }

    flushToolResults();

    if (msg.role === 'user') {
      const hasAttachments = msg.attachments && msg.attachments.length > 0;

      if (!hasAttachments) {
        result.push({ role: 'user', content: msg.content });
      } else {
        const blocks: AnthropicContentBlock[] = [];
        for (const att of msg.attachments!) blocks.push(attachmentToAnthropicBlock(att));
        if (msg.content) blocks.push({ type: 'text', text: msg.content });
        result.push({ role: 'user', content: blocks });
      }
    } else if (msg.role === 'assistant') {
      const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
      const hasAttachments = msg.attachments && msg.attachments.length > 0;

      if (!hasToolCalls && !hasAttachments) {
        result.push({ role: 'assistant', content: msg.content });
      } else {
        const blocks: AnthropicContentBlock[] = [];
        if (msg.content) blocks.push({ type: 'text', text: msg.content });
        if (hasToolCalls) {
          for (const tc of msg.toolCalls!) {
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
          }
        }
        if (hasAttachments) {
          for (const att of msg.attachments!) blocks.push(attachmentToAnthropicBlock(att));
        }
        result.push({ role: 'assistant', content: blocks });
      }
    }
  }

  flushToolResults();
  return result;
}
