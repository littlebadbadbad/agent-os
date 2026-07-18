import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineTool, resolveToolSetTools } from '@agent-type/defineTool';
import type { ToolSet, Tool } from '@agent-type';

describe('defineTool', () => {
  it('returns the same tool shape', () => {
    const schema = z.object({ name: z.string() });
    const tool = defineTool({
      name: 'greet',
      description: 'Greet someone',
      parameters: schema,
      execute: async ({ name }) => `Hello, ${name}!`,
    });

    expect(tool.name).toBe('greet');
    expect(tool.description).toBe('Greet someone');
    expect(tool.parameters).toBe(schema);
  });

  it('freezes the returned object', () => {
    const tool = defineTool({
      name: 'test',
      description: 'desc',
      parameters: z.object({}),
      execute: async () => 'ok',
    });

    expect(Object.isFrozen(tool)).toBe(true);
  });

  it('allows execute to return a value', async () => {
    const tool = defineTool({
      name: 'add',
      description: 'add two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    });

    const result = await tool.execute({ a: 2, b: 3 }, {
      sessionId: '', agentName: 'main', conversationId: '', sourceAgent: 'main', isSubAgent: false,
      signal: new AbortController().signal, });
    expect(result).toBe(5);
  });

  it('supports a factory function for parameters', async () => {
    const schema = z.object({ x: z.string() });
    const tool = defineTool({
      name: 'lazy',
      description: 'lazy schema',
      parameters: () => schema,
      execute: async () => 'ok',
    });

    // The factory should be called-through by execute/toDescriptor callers
    const resolved = typeof tool.parameters === 'function' ? tool.parameters() : tool.parameters;
    expect(resolved).toBe(schema);
  });

  it('supports a factory function for description', () => {
    const tool = defineTool({
      name: 'dynamic',
      description: () => 'computed description',
      parameters: z.object({}),
      execute: async () => null,
    });

    const desc = typeof tool.description === 'function' ? tool.description() : tool.description;
    expect(desc).toBe('computed description');
  });

  it('preserves optional group and rawParametersSchema fields', () => {
    const rawSchema = { type: 'object', properties: { x: { type: 'string' } } };
    const tool = defineTool({
      name: 'raw',
      description: 'raw schema tool',
      group: 'myGroup',
      parameters: z.object({}),
      rawParametersSchema: rawSchema,
      execute: async () => null,
    });

    expect(tool.group).toBe('myGroup');
    expect(tool.rawParametersSchema).toBe(rawSchema);
  });
});

// ── resolveToolSetTools ─────────────────────────────────────────────────────────

describe('resolveToolSetTools', () => {
  it('returns the tools array when tools is a static array', () => {
    const ts: ToolSet = {
      name: 'test',
      tools: [{ name: 't1', description: 'd1', parameters: z.object({}), execute: async () => 'ok' }],
    };
    const result = resolveToolSetTools(ts);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('t1');
  });

  it('returns tools from a factory function', () => {
    const tools = [{ name: 't1', description: 'd1', parameters: z.object({}), execute: async () => 'ok' }];
    const ts: ToolSet = {
      name: 'test',
      tools: () => tools,
    };
    const result = resolveToolSetTools(ts);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('t1');
  });

  it('returns empty array when tools is undefined', () => {
    const ts = {
      name: 'test',
      // No `tools` property at all
    } as unknown as ToolSet;
    const result = resolveToolSetTools(ts);
    expect(result).toEqual([]);
  });

  it('returns empty array when tools is null', () => {
    const ts: ToolSet = {
      name: 'test',
      tools: null as unknown as readonly Tool[],
    };
    const result = resolveToolSetTools(ts);
    expect(result).toEqual([]);
  });

  it('returns empty array when tools factory returns null', () => {
    const ts: ToolSet = {
      name: 'test',
      tools: (() => null) as unknown as () => readonly Tool[],
    };
    const result = resolveToolSetTools(ts);
    expect(result).toEqual([]);
  });

  it('returns empty array when tools factory returns undefined', () => {
    const ts: ToolSet = {
      name: 'test',
      tools: (() => undefined) as unknown as () => readonly Tool[],
    };
    const result = resolveToolSetTools(ts);
    expect(result).toEqual([]);
  });
});
