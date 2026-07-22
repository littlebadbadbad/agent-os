import { describe, it, expect, vi } from 'vitest';
import { createVariableToolSet } from '../toolSet';
import { deleteSessionStore, getSessionStore } from '../store';
import { MAIN_CONVERSATION_ID } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'vs-session-1', conversationId = MAIN_CONVERSATION_ID) {
  return { sessionId, agentName: 'main', conversationId };
}

function makeToolCtx(sessionId = 'vs-session-1', conversationId = MAIN_CONVERSATION_ID) {
  return {
    sessionId,
    agentName: 'main',
    conversationId,
    signal: new AbortController().signal,
    };
}

function getTool(ts: ReturnType<typeof createVariableToolSet>, name: string) {
  const tools = ts.tools as any[];
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool "${name}" not found`);
  return t;
}

// Unique session ids per test to avoid store cross-contamination.
let sessionCounter = 0;
function freshSessionId(): string {
  return `vs-test-${++sessionCounter}`;
}

// ── createVariableToolSet ─────────────────────────────────────────────────────

describe('createVariableToolSet', () => {
  // ── Shape ──────────────────────────────────────────────────────────────────

  it('returns a ToolSet with name "variable"', () => {
    const ts = createVariableToolSet();
    expect(ts.name).toBe('variable');
  });

  it('exports var_expand, var_read_path, var_write, var_list, var_delete tools', () => {
    const ts = createVariableToolSet();
    const names = (ts.tools as any[]).map((t) => t.name);
    expect(names).toContain('var_expand');
    expect(names).toContain('var_read_path');
    expect(names).toContain('var_write');
    expect(names).toContain('var_list');
    expect(names).toContain('var_delete');
  });

  // ── var_write ──────────────────────────────────────────────────────────────

  it('var_write stores JSON and returns a handle', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const result = await getTool(ts, 'var_write').execute(
      { json: '"hello world"' },
      ctx,
    );
    expect(result.handle).toMatch(/^\$var:[0-9a-f]{8}$/);
    expect(result.size).toBe(13); // JSON.stringify('"hello world"').length
  });

  it('var_write stores object JSON', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const result = await getTool(ts, 'var_write').execute(
      { json: '{"foo":1}', name: 'myObj' },
      ctx,
    );
    expect(result.handle).toMatch(/^\$var:[0-9a-f]{8}$/);
  });

  it('var_write returns error for invalid JSON', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const result = await getTool(ts, 'var_write').execute({ json: 'not json' }, ctx);
    expect(result.error).toMatch(/Invalid JSON/);
  });

  // ── var_expand ─────────────────────────────────────────────────────────────

  it('var_expand returns error for unknown handle', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const result = await getTool(ts, 'var_expand').execute({ handle: '$var:deadbeef' }, ctx);
    expect(result.error).toMatch(/not found/);
  });

  it('var_expand shows object children', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute(
      { json: '{"a":1,"b":"hello","c":[1,2]}' },
      ctx,
    );
    const result = await getTool(ts, 'var_expand').execute({ handle }, ctx);
    expect(result.type).toBe('object');
    expect(result.totalChildren).toBe(3);
    expect(result.children.find((c: any) => c.key === 'a').value).toBe(1);
    expect(result.children.find((c: any) => c.key === 'b').type).toBe('string');
    expect(result.children.find((c: any) => c.key === 'c').length).toBe(2);
  });

  it('var_expand paginates large objects', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const bigObj: Record<string, number> = {};
    for (let i = 0; i < 50; i++) bigObj[`key${i}`] = i;
    const { handle } = await getTool(ts, 'var_write').execute(
      { json: JSON.stringify(bigObj) },
      ctx,
    );
    const page1 = await getTool(ts, 'var_expand').execute({ handle, page: 1, pageSize: 10 }, ctx);
    expect(page1.totalChildren).toBe(50);
    expect(page1.totalPages).toBe(5);
    expect(page1.children).toHaveLength(10);
  });

  it('var_expand resolves nested path', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute(
      { json: '{"items":[{"id":1},{"id":2}]}' },
      ctx,
    );
    const result = await getTool(ts, 'var_expand').execute({ handle, path: 'items' }, ctx);
    expect(result.type).toBe('array');
    expect(result.totalChildren).toBe(2);
  });

  it('var_expand returns string info with preview', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '"short"' }, ctx);
    const result = await getTool(ts, 'var_expand').execute({ handle }, ctx);
    expect(result.type).toBe('string');
    expect(result.charCount).toBe(5); // "short".length
  });

  // ── var_read_path ──────────────────────────────────────────────────────────

  it('var_read_path returns error for unknown handle', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const result = await getTool(ts, 'var_read_path').execute({ handle: '$var:deadbeef' }, ctx);
    expect(result.error).toMatch(/not found/);
  });

  it('var_read_path reads root string value', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '"stored text"' }, ctx);
    const result = await getTool(ts, 'var_read_path').execute({ handle }, ctx);
    expect(result.type).toBe('string');
    expect(result.value).toBe('stored text');
  });

  it('var_read_path supports pagination via offset and maxLength', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '"ABCDEFGH"' }, ctx);
    const result = await getTool(ts, 'var_read_path').execute({ handle, offset: 2, maxLength: 3 }, ctx);
    expect(result.value).toBe('CDE');
    expect(result.hasMore).toBe(true);
  });

  it('var_read_path reads nested path', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute(
      { json: '{"data":{"name":"Alice","age":30}}' },
      ctx,
    );
    const result = await getTool(ts, 'var_read_path').execute({ handle, path: 'data.name' }, ctx);
    expect(result.type).toBe('string');
    expect(result.value).toBe('Alice');
  });

  it('var_read_path returns primitive directly', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '42' }, ctx);
    const result = await getTool(ts, 'var_read_path').execute({ handle }, ctx);
    expect(result.type).toBe('number');
    expect(result.value).toBe(42);
  });

  it('var_read_path returns key list for objects', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '{"x":1,"y":2}' }, ctx);
    const result = await getTool(ts, 'var_read_path').execute({ handle }, ctx);
    expect(result.type).toBe('object');
    expect(result.keys).toEqual(['x', 'y']);
    expect(result.totalKeys).toBe(2);
  });

  it('var_read_path paginates key list for arrays', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const arr = Array.from({ length: 25 }, (_, i) => i);
    const { handle } = await getTool(ts, 'var_write').execute({ json: JSON.stringify(arr) }, ctx);
    // page 2 with pageSize 10
    const result = await getTool(ts, 'var_read_path').execute({ handle, offset: 2, maxLength: 10 }, ctx);
    expect(result.type).toBe('array');
    expect(result.keys).toEqual(['10','11','12','13','14','15','16','17','18','19']);
    expect(result.totalKeys).toBe(25);
    expect(result.totalPages).toBe(3);
  });

  // ── var_list ───────────────────────────────────────────────────────────────

  it('var_list returns all stored variables', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    await getTool(ts, 'var_write').execute({ json: '"a"' }, ctx);
    await getTool(ts, 'var_write').execute({ json: '"b"' }, ctx);
    const result = await getTool(ts, 'var_list').execute({}, ctx);
    expect(result.total).toBe(2);
  });

  it('var_list reports valueType for json variables', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    await getTool(ts, 'var_write').execute({ json: '{"k":1}' }, ctx);
    const result = await getTool(ts, 'var_list').execute({}, ctx);
    expect(result.variables[0].valueType).toBe('object');
  });

  // ── var_delete ─────────────────────────────────────────────────────────────

  it('var_delete removes a variable', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '"to delete"' }, ctx);
    await getTool(ts, 'var_delete').execute({ handle }, ctx);
    const list = await getTool(ts, 'var_list').execute({}, ctx);
    expect(list.total).toBe(0);
  });

  // ── onInit ──────────────────────────────────────────────────────────

  it('onInit restores JSON variables from entryData', () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const saved = [
      { handle: '$var:aabbccdd', kind: 'json', value: 'restored content', size: 16, createdAt: Date.now(), source: 'tool-result' },
    ];
    // @ts-expect-error
    ts.onInit!(ctx, { id: sessionId, title: 'T', variables: saved });
    const store = getSessionStore(sessionId);
    expect(store.resolve('$var:aabbccdd' as any)).toBeDefined();
  });

  it('onInit ignores missing entryData variables', () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    expect(() => ts.onInit!(ctx, { id: sessionId, title: 'T' })).not.toThrow();
  });

  // ── onRemove ────────────────────────────────────────────────────────

  it('onRemove deletes the session store', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const toolCtx = makeToolCtx(sessionId);
    // Store something first
    await getTool(ts, 'var_write').execute({ json: '"data"' }, toolCtx);
    ts.onRemove!(ctx);
    // After removal, a fresh store is created — should be empty
    const store = getSessionStore(sessionId);
    expect(store.list()).toHaveLength(0);
  });

  // ── onReset ─────────────────────────────────────────────────────────

  it('onReset clears all variables', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const toolCtx = makeToolCtx(sessionId);
    const ctx = makeCtx(sessionId);
    await getTool(ts, 'var_write').execute({ json: '"data"' }, toolCtx);
    ts.onReset!(ctx);
    const list = await getTool(ts, 'var_list').execute({}, toolCtx);
    expect(list.total).toBe(0);
  });

  // ── onGetSymbolState ────────────────────────────────────────────────────────

  it('onGetSymbolState returns variables array', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const toolCtx = makeToolCtx(sessionId);
    const ctx = makeCtx(sessionId);
    await getTool(ts, 'var_write').execute({ json: '"state test"' }, toolCtx);
    const state = ts.onGetSymbolState!(ctx) as any;
    expect(Array.isArray(state.variables)).toBe(true);
    expect(state.variables.length).toBe(1);
  });

  it('onGetSymbolState returns variableStore reference', () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const state = ts.onGetSymbolState!(ctx) as any;
    expect(state.variableStore).toBeDefined();
    expect(typeof state.variableStore.list).toBe('function');
  });

  it('onGetSymbolState returns empty variables when session is fresh', () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const state = ts.onGetSymbolState!(ctx) as any;
    expect(state.variables).toHaveLength(0);
  });

  // ── onBuildSnapshot ────────────────────────────────────────────────────────

  it('onBuildSnapshot serializes JSON variables', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const toolCtx = makeToolCtx(sessionId);
    const ctx = makeCtx(sessionId);
    await getTool(ts, 'var_write').execute({ json: '{"key":"value"}', name: 'snap' }, toolCtx);
    const snapshot = ts.onBuildSnapshot!(ctx) as any;
    expect(Array.isArray(snapshot.variables)).toBe(true);
    expect(snapshot.variables).toHaveLength(1);
    expect(snapshot.variables[0].kind).toBe('json');
    expect(snapshot.variables[0].value).toEqual({ key: 'value' });
  });

  // ── onSubscribe ────────────────────────────────────────────────────────────

  it('onSubscribe fires when a variable is stored', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const toolCtx = makeToolCtx(sessionId);
    const fn = vi.fn();
    ts.onSubscribe!(ctx, fn);
    await getTool(ts, 'var_write').execute({ json: '"trigger"' }, toolCtx);
    expect(fn).toHaveBeenCalled();
  });

  it('onSubscribe returns an unsubscribe function', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const toolCtx = makeToolCtx(sessionId);
    const fn = vi.fn();
    const unsub = ts.onSubscribe!(ctx, fn);
    unsub();
    await getTool(ts, 'var_write').execute({ json: '"trigger"' }, toolCtx);
    expect(fn).not.toHaveBeenCalled();
  });

  // ── onGetSystemPrompt ──────────────────────────────────────────────────────

  it('onGetSystemPrompt returns undefined when no variables stored', () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    // @ts-expect-error
    const prompt = ts.onGetSystemPrompt!(ctx);
    expect(prompt).toBeUndefined();
  });

  it('onGetSystemPrompt returns variable registry when variables exist', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const toolCtx = makeToolCtx(sessionId);
    await getTool(ts, 'var_write').execute({ json: '"test data"', name: 'myVar' }, toolCtx);
    // @ts-expect-error
    const prompt = ts.onGetSystemPrompt!(ctx);
    expect(prompt).toMatch(/## Variable Store/);
    expect(prompt).toMatch(/\$var:/);
  });

  // ── onResolveToolArgs ──────────────────────────────────────────────────────

  it('onResolveToolArgs passes through var_ tool args unchanged', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const args = { handle: '$var:12345678' };
    const result = ts.onResolveToolArgs!(ctx, 'var_read_path', args);
    expect(result).toBe(args); // same reference — untouched
  });

  it('onResolveToolArgs resolves string-valued JSON handles in non-var_ tool args', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const toolCtx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '"resolved!"' }, toolCtx);
    const args = { input: handle };
    const resolved = ts.onResolveToolArgs!(ctx, 'some_other_tool', args) as any;
    expect(resolved.input).toBe('resolved!');
  });

  it('onResolveToolArgs resolves handle with dot-path suffix', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const toolCtx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '{"user":{"name":"Alice"}}' }, toolCtx);
    const args = { input: `${handle}.user.name` };
    const resolved = ts.onResolveToolArgs!(ctx, 'some_other_tool', args) as any;
    expect(resolved.input).toBe('Alice');
  });

  it('onResolveToolArgs resolves handle with bracket-path suffix', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const toolCtx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '[10,20,30]' }, toolCtx);
    const args = { input: `${handle}[1]` };
    const resolved = ts.onResolveToolArgs!(ctx, 'some_other_tool', args) as any;
    expect(resolved.input).toBe(20);
  });

  it('onResolveToolArgs resolves path-suffixed handle inline in string', async () => {
    const ts = createVariableToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const toolCtx = makeToolCtx(sessionId);
    const { handle } = await getTool(ts, 'var_write').execute({ json: '{"city":"Paris"}' }, toolCtx);
    const args = { msg: `Hello from ${handle}.city!` };
    const resolved = ts.onResolveToolArgs!(ctx, 'some_other_tool', args) as any;
    expect(resolved.msg).toBe('Hello from Paris!');
  });

  // ── session isolation ──────────────────────────────────────────────────────

  it('variables are isolated between sessions', async () => {
    const ts = createVariableToolSet();
    const sid1 = freshSessionId();
    const sid2 = freshSessionId();
    const ctx1 = makeToolCtx(sid1);
    const ctx2 = makeToolCtx(sid2);
    await getTool(ts, 'var_write').execute({ json: '"session1 data"' }, ctx1);
    const list = await getTool(ts, 'var_list').execute({}, ctx2);
    expect(list.total).toBe(0);
  });
});
