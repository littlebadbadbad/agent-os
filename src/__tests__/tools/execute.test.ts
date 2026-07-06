import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { executeToolCall } from '../../tools/execute';
import {
  emptyRegistry,
  withTool,
} from '../../tools/registry';
import type { ToolCall } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name, arguments: args };
}

function makeRegistry(...tools: Parameters<typeof withTool>[1][]) {
  let reg = emptyRegistry();
  for (const t of tools) reg = withTool(reg, t);
  return reg;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('executeToolCall', () => {
  it('executes a tool successfully and returns a ToolResult', async () => {
    const registry = makeRegistry({
      name: 'echo',
      description: 'echo text',
      parameters: z.object({ text: z.string() }),
      // @ts-expect-error �?testing that the execution context gets passed through, even though it's not used here
      execute: async ({ text }) => text,
    });

    const result = await executeToolCall(registry, makeCall('echo', { text: 'hello' }));
    expect(result).toEqual({ toolCallId: 'call-1', name: 'echo', result: 'hello' });
  });

  it('throws when the tool is not registered', async () => {
    await expect(executeToolCall(emptyRegistry(), makeCall('nonexistent'))).rejects.toThrow(
      '"nonexistent" is not registered',
    );
  });

  it('throws when arguments fail Zod validation', async () => {
    const registry = makeRegistry({
      name: 'strict',
      description: 'needs a number',
      parameters: z.object({ n: z.number() }),
      // @ts-expect-error �?testing that the execution context gets passed through, even though it's not used here
      execute: async ({ n }) => n,
    });

    await expect(
      executeToolCall(registry, makeCall('strict', { n: 'not-a-number' })),
    ).rejects.toThrow('Invalid arguments');
  });

  it('passes the execution context to the tool', async () => {
    const executeSpy = vi.fn(async (_args: unknown, ctx: { sessionId?: string }) => ctx.sessionId ?? 'none');
    const registry = makeRegistry({
      name: 'ctx_tool',
      description: 'returns session id',
      parameters: z.object({}),
      execute: executeSpy,
    });

    await executeToolCall(registry, makeCall('ctx_tool'), { sessionId: 'session-42', agentName: 'main', conversationId: 'session-42', signal: new AbortController().signal, });
    expect(executeSpy).toHaveBeenCalledWith({}, expect.objectContaining({ sessionId: 'session-42' }));
  });

  it('truncates string results exceeding the 40 000-char limit', async () => {
    const LONG = 'x'.repeat(50_000);
    const registry = makeRegistry({
      name: 'big',
      description: 'returns big string',
      parameters: z.object({}),
      execute: async () => LONG,
    });

    const result = await executeToolCall(registry, makeCall('big'));
    expect(typeof result.result).toBe('string');
    expect((result.result as string).includes('chars omitted')).toBe(true);
    expect((result.result as string).length).toBeLessThan(50_000);
  });

  it('truncates object results by JSON-serialising then clamping', async () => {
    const large = { items: Array.from({ length: 5_000 }, (_, i) => ({ id: i, value: 'x'.repeat(10) })) };
    const registry = makeRegistry({
      name: 'big_obj',
      description: 'big object',
      parameters: z.object({}),
      execute: async () => large,
    });

    const result = await executeToolCall(registry, makeCall('big_obj'));
    // Result should be a string (truncated JSON) if it exceeds 40_000 chars
    if (JSON.stringify(large).length > 40_000) {
      expect(typeof result.result).toBe('string');
      expect((result.result as string).includes('chars omitted')).toBe(true);
    }
  });

  it('returns small objects unchanged (not stringified)', async () => {
    const obj = { a: 1, b: 'two' };
    const registry = makeRegistry({
      name: 'small_obj',
      description: 'small object',
      parameters: z.object({}),
      execute: async () => obj,
    });

    const result = await executeToolCall(registry, makeCall('small_obj'));
    expect(result.result).toEqual(obj);
  });

  it('works with a factory-function schema', async () => {
    const registry = makeRegistry({
      name: 'lazy_schema',
      description: 'lazy',
      parameters: () => z.object({ v: z.string() }),
      // @ts-expect-error �?testing that factory-function schemas are supported, even though the executeToolCall signature doesn't currently reflect that
      execute: async ({ v }) => v,
    });

    const result = await executeToolCall(registry, makeCall('lazy_schema', { v: 'ok' }));
    expect(result.result).toBe('ok');
  });

  it('preserves the toolCallId from the call', async () => {
    const registry = makeRegistry({
      name: 'id_test',
      description: 'id',
      parameters: z.object({}),
      execute: async () => null,
    });

    const call: ToolCall = { id: 'my-unique-id', name: 'id_test', arguments: {} };
    const result = await executeToolCall(registry, call);
    expect(result.toolCallId).toBe('my-unique-id');
  });

  it('extracts __toolAttachments__ from tool result', async () => {
    const attachment = { source: 'data' as const, kind: 'image' as const, mimeType: 'image/png', data: 'base64data' };
    const registry = makeRegistry({
      name: 'attach_tool',
      description: 'returns attachment',
      parameters: z.object({}),
      execute: async () => ({
        text: 'result text',
        __toolAttachments__: [attachment],
      }),
    });

    const result = await executeToolCall(registry, makeCall('attach_tool'));
    expect(result.attachments).toBeDefined();
    expect(result.attachments).toHaveLength(1);
    const att = result.attachments![0];
    // Narrow to DataAttachment via discriminant before accessing `mimeType`
    expect(att.source).toBe('data');
    if (att.source === 'data') {
      expect(att.kind).toBe('image');
      expect(att.mimeType).toBe('image/png');
    }
  });

  it('extracts __toolAttachments__ and separates from result data', async () => {
    const registry = makeRegistry({
      name: 'hybrid_tool',
      description: 'returns data with attachments',
      parameters: z.object({}),
      execute: async () => ({
        __toolAttachments__: [{ type: 'file', mimeType: 'text/plain', data: 'abc' }],
        key: 'value',
      }),
    });

    const result = await executeToolCall(registry, makeCall('hybrid_tool'));
    expect(result.attachments).toHaveLength(1);
    expect(result.result).toEqual({ key: 'value' });
  });
});
