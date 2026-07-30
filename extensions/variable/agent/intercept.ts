import type { ToolResult, Attachment } from '@agent-type';
import type { VariableHandle, VariableStore } from './types';
import { generateOverview } from './json-overview';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function storeAttachment(
  store: VariableStore,
  attachment: Attachment,
  toolName: string,
): { handle: VariableHandle; mimeType: string; size: number; name?: string } {
  const handle = store.store(
    { kind: 'attachment', attachment },
    { source: 'tool-result', toolName, name: attachment.source === 'data' ? attachment.name : undefined },
  );
  const mimeType = attachment.source === 'data' ? attachment.mimeType : 'image/*';
  const size = attachment.source === 'data' ? Math.round(attachment.data.length * 0.75) : 0;
  const name = attachment.source === 'data' ? attachment.name : undefined;
  return { handle, mimeType, size, ...(name !== undefined ? { name } : {}) };
}

function tryParseJsonString(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return raw;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object') return parsed;
  } catch { /* not valid JSON */ }
  return raw;
}

export function interceptResult(
  store: VariableStore,
  toolName: string,
  result: ToolResult,
  threshold: number,
): ToolResult {
  const attachmentMetas = result.attachments?.length
    ? result.attachments.map((a) => storeAttachment(store, a, toolName))
    : undefined;

  const rawResult = result.result;
  const serialized = rawResult !== undefined ? JSON.stringify(rawResult) : 'null';
  let body: unknown = rawResult;

  if (serialized.length > threshold) {
    const value = tryParseJsonString(result.result);
    const handle = store.store(
      { kind: 'json', value: value as never },
      { source: 'tool-result', toolName },
    );
    const overview = generateOverview(value as never);
    body = {
      _var: handle,
      size: formatSize(serialized.length),
      _strategy: overview.strategy,
      _hint: overview.strategyHint,
    };
  }

  if (!attachmentMetas) {
    if (body === result.result) return result;
    return { ...result, result: body };
  }

  const withAttachments: Record<string, unknown> =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), _attachmentVars: attachmentMetas }
      : { result: body, _attachmentVars: attachmentMetas };

  return { ...result, result: withAttachments };
}
