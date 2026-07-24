import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  defineTool,
  buildTool,
  TOOL_DEFAULTS,
  resolveToolSetTools,
  resolveToolField,
  resolveFactory,
} from '../defineTool';
import type { Tool, ToolField, ToolExecutionContext } from '../core';
import { ToolSet } from '../toolset';

describe('defineTool', () => {
  it('returns the same tool object (identity)', () => {
    const tool: Tool = {
      name: 'test_tool',
      description: 'A test tool',
      parameters: z.object({ x: z.string() }),
      execute: async () => 'ok',
    };
    expect(defineTool(tool)).toBe(tool);
  });

  it('freezes the returned object', () => {
    const tool = defineTool({
      name: 'frozen_tool',
      description: 'Should be frozen',
      parameters: z.object({}),
      execute: async () => 42,
    });
    expect(Object.isFrozen(tool)).toBe(true);
  });

  it('preserves all properties', () => {
    const execute = async () => ({ result: true });
    const tool = defineTool({
      name: 'full_tool',
      description: 'Full tool with all props',
      parameters: z.object({ input: z.number() }),
      execute,
      isReadOnly: true,
      isDestructive: false,
      isConcurrencySafe: true,
      interruptBehavior: 'block' as const,
    });
    expect(tool.name).toBe('full_tool');
    expect(tool.description).toBe('Full tool with all props');
    expect(tool.isReadOnly).toBe(true);
    expect(tool.isDestructive).toBe(false);
    expect(tool.isConcurrencySafe).toBe(true);
    expect(tool.interruptBehavior).toBe('block');
    expect(tool.execute).toBe(execute);
  });

  it('infers parameter type from zod schema', async () => {
    const tool = defineTool({
      name: 'echo',
      description: 'Echo input',
      parameters: z.object({ msg: z.string() }),
      execute: async ({ msg }) => msg,
    });
    const result = await tool.execute({ msg: 'hello' }, { signal: new AbortController().signal, sessionId: 'test', agentName: 'test', conversationId: 'test', sourceAgent: 'main', isSubAgent: false });
    expect(result).toBe('hello');
  });
});

describe('buildTool', () => {
  it('fills in safe defaults for optional fields', () => {
    const tool = buildTool({
      name: 'defaults_tool',
      description: 'Check defaults',
      parameters: z.object({}),
      execute: async () => 'ok',
    });
    expect(tool.isReadOnly).toBe(TOOL_DEFAULTS.isReadOnly);
    expect(tool.isDestructive).toBe(TOOL_DEFAULTS.isDestructive);
    expect(tool.isConcurrencySafe).toBe(TOOL_DEFAULTS.isConcurrencySafe);
    expect(tool.interruptBehavior).toBe(TOOL_DEFAULTS.interruptBehavior);
  });

  it('respects explicit field overrides over defaults', () => {
    const tool = buildTool({
      name: 'override_tool',
      description: 'Overrides all defaults',
      parameters: z.object({}),
      execute: async () => 'ok',
      isReadOnly: true,
      isDestructive: true,
      isConcurrencySafe: true,
      interruptBehavior: 'block',
    });
    expect(tool.isReadOnly).toBe(true);
    expect(tool.isDestructive).toBe(true);
    expect(tool.isConcurrencySafe).toBe(true);
    expect(tool.interruptBehavior).toBe('block');
  });

  it('freezes the returned object', () => {
    const tool = buildTool({
      name: 'frozen_build',
      description: 'Frozen',
      parameters: z.object({}),
      execute: async () => null,
    });
    expect(Object.isFrozen(tool)).toBe(true);
  });

  it('partial defaults: only some fields specified', () => {
    const tool = buildTool({
      name: 'partial',
      description: 'Partial overrides',
      parameters: z.object({}),
      execute: async () => null,
      isReadOnly: true,
    });
    expect(tool.isReadOnly).toBe(true);
    expect(tool.isDestructive).toBe(false); // default
    expect(tool.isConcurrencySafe).toBe(false); // default
    expect(tool.interruptBehavior).toBe('block'); // default
  });

  it('works with async execute', async () => {
    const tool = buildTool({
      name: 'async_tool',
      description: 'Async test',
      parameters: z.object({ val: z.number() }),
      execute: async ({ val }) => val * 2,
    });
    const result = await tool.execute({ val: 21 }, { signal: new AbortController().signal, sessionId: 'test', agentName: 'test', conversationId: 'test', sourceAgent: 'main', isSubAgent: false });
    expect(result).toBe(42);
  });
});

describe('TOOL_DEFAULTS', () => {
  it('has the correct default values', () => {
    expect(TOOL_DEFAULTS).toEqual({
      isReadOnly: false,
      isDestructive: false,
      isConcurrencySafe: false,
      interruptBehavior: 'block',
    });
  });
});

describe('resolveToolSetTools', () => {
  it('returns tools array when tools is a static array', () => {
    const tool1: Tool = { name: 'a', description: '', parameters: z.object({}), execute: async () => {} };
    const tool2: Tool = { name: 'b', description: '', parameters: z.object({}), execute: async () => {} };
    const ts = { tools: [tool1, tool2] } as unknown as ToolSet;
    const result = resolveToolSetTools(ts);
    expect(result).toEqual([tool1, tool2]);
  });

  it('calls the factory function when tools is a function', () => {
    const tool: Tool = { name: 'factory_tool', description: '', parameters: z.object({}), execute: async () => {} };
    const factory = () => [tool];
    const ts = { tools: factory } as unknown as ToolSet;
    const result = resolveToolSetTools(ts);
    expect(result).toEqual([tool]);
  });

  it('returns empty array when tools is null', () => {
    const ts = { tools: null } as unknown as ToolSet;
    expect(resolveToolSetTools(ts)).toEqual([]);
  });

  it('returns empty array when tools is undefined', () => {
    const ts = { tools: undefined } as unknown as ToolSet;
    expect(resolveToolSetTools(ts)).toEqual([]);
  });
});

describe('resolveToolField', () => {
  const schema = z.object({ x: z.number() });

  it('returns fallback when field is undefined', () => {
    expect(resolveToolField(undefined, { x: 1 }, 'fallback')).toBe('fallback');
  });

  it('returns the value directly when field is a plain value', () => {
    expect(resolveToolField('direct', { x: 1 }, 'fallback')).toBe('direct');
  });

  it('calls the function with params when field is a function', () => {
    const fn: ToolField<string, typeof schema> = (params) => `got-${params.x}`;
    expect(resolveToolField<string, typeof schema>(fn, { x: 42 }, 'fallback')).toBe('got-42');
  });
});

describe('resolveFactory', () => {
  it('returns the value directly when given a plain value', () => {
    expect(resolveFactory(42)).toBe(42);
    expect(resolveFactory('hello')).toBe('hello');
    expect(resolveFactory(null)).toBe(null);
  });

  it('calls the function when given a factory', () => {
    expect(resolveFactory(() => 42)).toBe(42);
    expect(resolveFactory(() => 'dynamic')).toBe('dynamic');
  });

  it('passes through object references', () => {
    const obj = { a: 1 };
    expect(resolveFactory(obj)).toBe(obj);
    expect(resolveFactory(() => obj)).toBe(obj);
  });
});
