import type { ToolResult, Attachment } from '@agent-type';
import type { VariableHandle, VariableStore, JsonValue } from './types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * If `value` is a string whose content is a JSON object or array, return the
 * parsed structure so it can be navigated with `var_expand` / `var_read_path`.
 *
 * JSON primitives (numbers, booleans, null) are deliberately not promoted —
 * a string like `"42"` stays a string so callers know it arrived as text.
 */
function coerceToJson(value: unknown): JsonValue {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed[0] === '{' || trimmed[0] === '[') {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed !== null && typeof parsed === 'object') {
          return parsed as JsonValue;
        }
      } catch {
        // not valid JSON — fall through
      }
    }
  }
  return value as JsonValue;
}

function storeAttachment(
  store: VariableStore,
  attachment: Attachment,
  toolName: string,
): { handle: VariableHandle; mimeType: string; size: number; name?: string } {
  const handle = store.store(
    { kind: 'attachment', attachment },
    {
      source: 'tool-result',
      toolName,
      name: attachment.source === 'data' ? attachment.name : undefined,
    },
  );
  const mimeType = attachment.source === 'data' ? attachment.mimeType : 'image/*';
  const size = attachment.source === 'data' ? Math.round(attachment.data.length * 0.75) : 0;
  const name = attachment.source === 'data' ? attachment.name : undefined;
  return { handle, mimeType, size, ...(name !== undefined && { name }) };
}

/**
 * Intercept a tool result, storing large payloads as JSON variables.
 *
 * - Attachment side-channel entries are always extracted and stored as attachment variables.
 * - The result body is stored as a JSON variable when its serialized length exceeds the threshold.
 *   The caller receives a compact stub with the handle and a usage hint instead.
 */
export function interceptResult(
  store: VariableStore,
  toolName: string,
  result: ToolResult,
  threshold: number,
): ToolResult {
  // ── Attachment side-channel ───────────────────────────────────────────────
  const attachmentMetas = result.attachments?.length
    ? result.attachments.map((a) => storeAttachment(store, a, toolName))
    : undefined;

  // ── Body size check ───────────────────────────────────────────────────────
  const rawResult = result.result;
  const serialized = rawResult !== undefined ? JSON.stringify(rawResult) : 'null';
  let body: unknown = rawResult;

  if (serialized.length > threshold) {
    const handle = store.store(
      { kind: 'json', value: coerceToJson(result.result) },
      { source: 'tool-result', toolName },
    );
    body = {
      _var: handle,
      size: formatSize(serialized.length),
      hint: `Result too large for inline display. Use var_expand("${handle}") to browse structure, or var_read_path("${handle}", "path") to read a specific field.`,
    };
  }

  // ── Assemble output ───────────────────────────────────────────────────────
  if (!attachmentMetas) {
    if (body === result.result) return result; // nothing changed
    return { ...result, result: body };
  }

  const withAttachments =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), _attachmentVars: attachmentMetas }
      : { result: body, _attachmentVars: attachmentMetas };

  return { ...result, result: withAttachments };
}
