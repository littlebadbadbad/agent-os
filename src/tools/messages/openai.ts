import type {
  AgentMessage,
  Attachment,
  DataAttachment,
  OpenAIMessage,
  OpenAIContentPart,
} from '@agent-type';
import { isDataAttachment, isUrlAttachment } from './attachment';

function attachmentToOpenAIPart(attachment: Attachment): OpenAIContentPart {
  if (isUrlAttachment(attachment)) {
    return { type: 'image_url', image_url: { url: attachment.url, detail: 'auto' } };
  }

  const a = attachment as DataAttachment;

  if (a.kind === 'image') {
    return {
      type: 'image_url',
      image_url: { url: `data:${a.mimeType};base64,${a.data}`, detail: 'auto' },
    };
  }

  // Non-image attachments: surface as a text notice.
  const label = a.name ?? `${a.kind} file (${a.mimeType})`;
  return { type: 'text', text: `[Attached ${a.kind}: ${label}]` };
}

/**
 * Convert `AgentMessage[]` to the OpenAI Chat Completions `messages[]` format.
 *
 * Handles user messages with attachments (multipart content), assistant
 * messages with optional `tool_calls`, and tool result messages.
 */
export function toOpenAIMessages(messages: readonly AgentMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const hasAttachments = msg.attachments && msg.attachments.length > 0;

      if (!hasAttachments) {
        result.push({ role: 'user', content: msg.content });
      } else {
        const parts: OpenAIContentPart[] = [];
        if (msg.content) parts.push({ type: 'text', text: msg.content });
        for (const att of msg.attachments!) parts.push(attachmentToOpenAIPart(att));
        result.push({ role: 'user', content: parts });
      }
    } else if (msg.role === 'assistant') {
      result.push({
        role: 'assistant',
        content: msg.content,
        // Use != null (not falsy) so empty-string thinking is echoed back as
        // reasoning_content — thinking models require every assistant turn's
        // reasoning_content to be present in subsequent requests.
        ...(msg.thinking != null     ? { reasoning_content: msg.thinking }                      : {}),
        ...(msg.toolCalls?.length  ? {
              tool_calls: msg.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }                                                                                    : {}),
      });
    } else if (msg.role === 'tool') {
      const text =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (msg.attachments && msg.attachments.length > 0) {
        // Vision-capable models (GPT-4o, etc.) support array content in tool messages.
        const parts: OpenAIContentPart[] = [{ type: 'text', text }];
        for (const att of msg.attachments) parts.push(attachmentToOpenAIPart(att));
        result.push({ role: 'tool', tool_call_id: msg.toolCallId, content: parts });
      } else {
        result.push({ role: 'tool', tool_call_id: msg.toolCallId, content: text });
      }
    }
  }

  return result;
}
