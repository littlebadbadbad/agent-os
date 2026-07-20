import type { VariableStore } from './types';
import type { Attachment } from '@agent-type';
import { isVariableHandle, parseHandleRef, HANDLE_REF_RE } from './store';
import { parsePath } from './json-path';
import { getAtPath } from './json-path';
import type { JsonValue } from './types';

/**
 * Resolve a JSON variable to its value at an optional path, returning
 * a string-safe representation suitable for tool arguments.
 * - Primitives serialized via String() for string contexts.
 * - Objects/arrays → JSON.stringify.
 * - Strings → returned as-is.
 */
function resolveJsonAtPath(value: JsonValue, path: string): JsonValue | undefined {
  if (!path) return value;
  const segments = parsePath(path);
  return getAtPath(value, segments);
}

function jsonToString(v: JsonValue): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function resolveValue(store: VariableStore, value: unknown): unknown {
  if (typeof value === 'string') {
    // ── Exact full-string reference: "$var:xxxxxxxx" or "$var:xxxxxxxx.a.b[0]" ──
    const fullRef = parseHandleRef(value);
    if (fullRef) {
      const entry = store.resolve(fullRef.handle);
      if (!entry) return value;
      if (entry.kind === 'attachment') {
        // Path suffix on an attachment doesn't make sense — return the attachment.
        return entry.attachment;
      }
      const resolved = resolveJsonAtPath(entry.value, fullRef.path);
      if (resolved === undefined) return value; // path not found — leave intact
      return resolved; // return JsonValue directly so callers get the native type
    }

    // ── Inline interpolation: "some text $var:xxxxxxxx.a.b suffix" ──
    if (value.includes('$var:')) {
      const re = new RegExp(HANDLE_REF_RE.source, 'g');
      return value.replace(re, (ref) => {
        const r = parseHandleRef(ref);
        if (!r) return ref;
        const entry = store.resolve(r.handle);
        if (!entry) return ref;
        if (entry.kind === 'attachment') return ref; // can't inline attachments
        const resolved = resolveJsonAtPath(entry.value, r.path);
        if (resolved === undefined) return ref;
        return jsonToString(resolved);
      });
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(store, item));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = resolveValue(store, v);
    }
    return result;
  }

  return value;
}

export function resolveArguments(
  store: VariableStore,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return resolveValue(store, args) as Record<string, unknown>;
}

/**
 * Resolve a list of variable handles to their backing `Attachment` objects.
 *
 * Handles that do not exist or point to JSON variables are silently skipped —
 * only `AttachmentVariable` entries are returned.
 */
export function resolveHandlesToAttachments(
  store: VariableStore,
  handles: readonly string[],
): readonly Attachment[] {
  const attachments: Attachment[] = [];
  for (const h of handles) {
    if (!isVariableHandle(h)) continue;
    const entry = store.resolve(h as `$var:${string}`);
    if (entry?.kind === 'attachment') attachments.push(entry.attachment);
  }
  return attachments;
}
