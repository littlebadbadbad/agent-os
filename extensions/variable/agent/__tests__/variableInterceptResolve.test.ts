/**
 * Tests for variable interceptResult and resolve modules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interceptResult } from '../intercept';
import { resolveArguments, resolveHandlesToAttachments } from '../resolve';
import { getSessionStore } from '../store';
import type { ToolResult, Attachment } from '@agent-type';

// ── interceptResult ───────────────────────────────────────────────────────────

describe('interceptResult', () => {
  it('returns result unchanged when result is small and has no attachments', () => {
    const store = getSessionStore('test-sess');
    const result: ToolResult = { toolCallId: 'tc-1', name: 'echo', result: 'small text' };
    const returned = interceptResult(store, 'echo', result, 16000);
    expect(returned).toBe(result);
  });

  it('stores large result as variable and returns a stub', () => {
    const store = getSessionStore('test-large');
    const large = 'x'.repeat(20000);
    const result: ToolResult = { toolCallId: 'tc-1', name: 'echo', result: large };
    const returned = interceptResult(store, 'echo', result, 100);
    const parsed = returned.result as Record<string, unknown>;
    expect(parsed._var).toMatch(/^\$var:/);
    expect(parsed.hint).toContain('var_expand');
  });

  it('handles null result gracefully', () => {
    const store = getSessionStore('test-null');
    const result: ToolResult = { toolCallId: 'tc-1', name: 'echo', result: null };
    const returned = interceptResult(store, 'echo', result, 16000);
    expect(returned.toolCallId).toBe('tc-1');
    expect(returned.result).toBeNull();
    // null should not trigger variable storage
  });

  it('handles undefined result gracefully', () => {
    const store = getSessionStore('test-undef');
    const result: ToolResult = { toolCallId: 'tc-1', name: 'echo', result: undefined as unknown as string };
    const returned = interceptResult(store, 'echo', result, 16000);
    expect(returned.toolCallId).toBe('tc-1');
    // undefined serialized as 'null' via JSON.stringify
    expect(returned.result).toBeUndefined();
  });

  it('extracts attachments from result side-channel', () => {
    const store = getSessionStore('test-att');
    const attachment: Attachment = { source: 'data', kind: 'image', mimeType: 'image/png', data: 'abc' };
    const result: ToolResult = {
      toolCallId: 'tc-1',
      name: 'echo',
      result: { data: 'hello' },
      attachments: [attachment],
    };
    const returned = interceptResult(store, 'echo', result, 16000);
    // Should have _attachmentVars added
    const parsed = returned.result as Record<string, unknown>;
    expect(parsed._attachmentVars).toBeDefined();
    expect(Array.isArray(parsed._attachmentVars)).toBe(true);
    expect((parsed._attachmentVars as Array<unknown>).length).toBe(1);
  });
});

// ── resolveArguments ──────────────────────────────────────────────────────────

describe('resolveArguments', () => {
  it('passes through plain values unchanged', () => {
    const store = getSessionStore('resolve-plain');
    const args = { a: 1, b: 'hello', c: true };
    const result = resolveArguments(store, args);
    expect(result).toEqual(args);
  });

  it('resolves $var: handle references to stored values', () => {
    const store = getSessionStore('resolve-var');
    const handle = store.store({ kind: 'json', value: { key: 'stored_value' } }, { source: 'tool-result', toolName: 'test' });
    // handle is like '$var:xxxx' — pass directly as the full string reference
    const args = { data: handle };
    const result = resolveArguments(store, args);
    expect(result.data).toEqual({ key: 'stored_value' });
  });

  it('does not crash when no variables exist', () => {
    const store = getSessionStore('resolve-empty');
    const args = { x: 'no variable here', y: 42 };
    const result = resolveArguments(store, args);
    expect(result).toEqual(args);
  });

  it('handles nested arrays', () => {
    const store = getSessionStore('resolve-arr');
    const args = { list: [1, { nested: 'value' }, 'text'] };
    const result = resolveArguments(store, args);
    expect(result).toEqual(args);
  });

  it('preserves $var: handle when the handle does not exist in store', () => {
    const store = getSessionStore('resolve-missing');
    const args = { ref: '$var:xxxxxxxx' };
    const result = resolveArguments(store, args);
    expect(result.ref).toBe('$var:xxxxxxxx');
  });
});

// ── resolveHandlesToAttachments ───────────────────────────────────────────────

describe('resolveHandlesToAttachments', () => {
  it('returns empty array for empty handles list', () => {
    const store = getSessionStore('att-empty');
    const result = resolveHandlesToAttachments(store, []);
    expect(result).toEqual([]);
  });

  it('skips handles that are not in $var: format', () => {
    const store = getSessionStore('att-skip');
    const result = resolveHandlesToAttachments(store, ['not-a-handle', 'regular text']);
    expect(result).toEqual([]);
  });

  it('resolves attachment handles to Attachment objects', () => {
    const store = getSessionStore('att-resolve');
    const attachment: Attachment = { source: 'data', kind: 'image', mimeType: 'image/png', data: 'xyz' };
    const handle = store.store({ kind: 'attachment', attachment }, { source: 'user', name: 'test.png' });
    const result = resolveHandlesToAttachments(store, [handle]);
    expect(result).toHaveLength(1);
    expect(result[0].data).toBe('xyz');
  });

  it('skips JSON variable handles', () => {
    const store = getSessionStore('att-json');
    store.store({ kind: 'json', value: { a: 1 } }, { source: 'tool-result', toolName: 'test' });
    const handle = store.store({ kind: 'json', value: 'string value' }, { source: 'tool-result', toolName: 'test' });
    const result = resolveHandlesToAttachments(store, [handle]);
    // JSON variables should not be returned as attachments
    expect(result).toEqual([]);
  });
});
