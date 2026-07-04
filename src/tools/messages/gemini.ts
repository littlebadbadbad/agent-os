import type {
  AgentMessage,
  Attachment,
  DataAttachment,
  GeminiContent,
  GeminiPart,
} from '@agent-type';
import { isUrlAttachment } from './attachment';

function attachmentToGeminiPart(attachment: Attachment): GeminiPart {
  if (isUrlAttachment(attachment)) {
    // Gemini fileData requires a mimeType; UrlAttachment is constrained to kind:'image'
    // so default to image/jpeg if the mimeType cannot be inferred from the URL.
    const ext = attachment.url.split('?')[0].split('.').pop()?.toLowerCase();
    const mimeType =
      ext === 'png'  ? 'image/png'  :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif'  ? 'image/gif'  :
                       'image/jpeg';
    return { fileData: { mimeType, fileUri: attachment.url } };
  }
  const a = attachment as DataAttachment;
  return { inlineData: { mimeType: a.mimeType, data: a.data } };
}

/**
 * Convert `AgentMessage[]` to the Google Gemini `contents[]` wire format.
 *
 * Gemini uses `'model'` instead of `'assistant'`. Tool results become
 * `functionResponse` parts inside a `'user'` content entry; consecutive
 * results are merged into a single entry.
 */
export function toGeminiMessages(messages: readonly AgentMessage[]): GeminiContent[] {
  const result: GeminiContent[] = [];
  let pendingFunctionResponses: GeminiPart[] = [];

  function flushFunctionResponses(): void {
    if (pendingFunctionResponses.length > 0) {
      result.push({ role: 'user', parts: pendingFunctionResponses });
      pendingFunctionResponses = [];
    }
  }

  for (const msg of messages) {
    if (msg.role === 'tool') {
      pendingFunctionResponses.push({
        functionResponse: {
          name: msg.name,
          response: { name: msg.name, content: msg.content },
        },
      });
      continue;
    }

    flushFunctionResponses();

    if (msg.role === 'user') {
      const parts: GeminiPart[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.attachments) {
        for (const att of msg.attachments) parts.push(attachmentToGeminiPart(att));
      }
      result.push({ role: 'user', parts });
    } else if (msg.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
        }
      }
      if (msg.attachments) {
        for (const att of msg.attachments) parts.push(attachmentToGeminiPart(att));
      }
      result.push({ role: 'model', parts });
    }
  }

  flushFunctionResponses();
  return result;
}
