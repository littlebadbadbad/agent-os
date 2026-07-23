import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  toDescriptor,
  toDescriptors,
  toOpenAITool,
  toAnthropicTool,
  toGeminiTool,
  resolveToolDescription,
} from '../../tools/toDescriptor';
import type { Tool } from '@agent-type';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const simpleTool: Tool = {
  name: 'say_hello',
  description: 'Say hello to someone',
  parameters: z.object({
    name: z.string().describe('The target name'),
  }),
  execute: async () => null,
};

const lazyDescTool: Tool = {
  name: 'lazy_desc',
  description: () => 'computed description',
  parameters: z.object({}),
  execute: async () => null,
};

const rawSchemaTool: Tool = {
  name: 'raw_schema',
  description: 'uses raw schema',
  parameters: z.object({}), // ignored
  rawParametersSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  execute: async () => null,
};

// ── toDescriptor ──────────────────────────────────────────────────────────────

describe('toDescriptor', () => {
  it('converts a tool to a ToolDescriptor', () => {
    const d = toDescriptor(simpleTool);
    expect(d.name).toBe('say_hello');
    expect(d.description).toBe('Say hello to someone');
    expect(d.parameters).toBeDefined();
  });

  it('generates JSON Schema with property types from Zod', () => {
    const d = toDescriptor(simpleTool);
    const params = d.parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
    const props = params.properties as Record<string, unknown>;
    expect(props).toHaveProperty('name');
  });

  it('resolves a factory description', () => {
    const d = toDescriptor(lazyDescTool);
    expect(d.description).toBe('computed description');
  });

  it('uses rawParametersSchema when provided, bypassing Zod', () => {
    const d = toDescriptor(rawSchemaTool);
    expect(d.parameters).toEqual(rawSchemaTool.rawParametersSchema);
  });

  it('resolves a factory rawParametersSchema', () => {
    const rawSchema = { type: 'object', properties: {} };
    const tool: Tool = {
      name: 'lazy_raw',
      description: 'lazy raw',
      parameters: z.object({}),
      rawParametersSchema: () => rawSchema,
      execute: async () => null,
    };
    const d = toDescriptor(tool);
    expect(d.parameters).toBe(rawSchema);
  });

  it('strips $schema from generated JSON Schema', () => {
    const d = toDescriptor(simpleTool);
    expect((d.parameters as Record<string, unknown>).$schema).toBeUndefined();
  });

  it('resolves a factory-function parameters schema', () => {
    const schemaFn: Tool = {
      name: 'factory_params',
      description: 'factory',
      parameters: () => z.object({ n: z.number() }),
      execute: async () => null,
    };
    const d = toDescriptor(schemaFn);
    expect(d.name).toBe('factory_params');
    const props = (d.parameters as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).toHaveProperty('n');
  });
});

// ── resolveToolDescription ────────────────────────────────────────────────────

describe('resolveToolDescription', () => {
  it('returns static description when no getDescription hook', async () => {
    const result = await resolveToolDescription(
      simpleTool,
      {},
      {} as never,
    );
    expect(result).toBe('Say hello to someone');
  });

  it('returns factory description when description is a function', async () => {
    const result = await resolveToolDescription(
      lazyDescTool,
      {},
      {} as never,
    );
    expect(result).toBe('computed description');
  });

  it('calls getDescription when the hook exists', async () => {
    const getDescription = vi.fn(async () => 'dynamic desc');
    const toolWithHook: Tool = {
      ...simpleTool,
      getDescription,
    };
    const params = { name: 'world' };
    const result = await resolveToolDescription(toolWithHook, params, {} as never);
    expect(result).toBe('dynamic desc');
    expect(getDescription).toHaveBeenCalledWith(params, {});
  });

  it('getDescription result takes priority over static description', async () => {
    const toolWithHook: Tool = {
      ...simpleTool,
      getDescription: async () => 'override desc',
    };
    const result = await resolveToolDescription(toolWithHook, {}, {} as never);
    // Should return from getDescription, NOT from tool.description
    expect(result).toBe('override desc');
  });
});

describe('toDescriptors', () => {
  it('converts an array of tools', () => {
    const result = toDescriptors([simpleTool, lazyDescTool]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('say_hello');
    expect(result[1].name).toBe('lazy_desc');
  });

  it('returns an empty array for empty input', () => {
    expect(toDescriptors([])).toEqual([]);
  });
});

// ── toOpenAITool ──────────────────────────────────────────────────────────────

describe('toOpenAITool', () => {
  it('wraps the descriptor in OpenAI format', () => {
    const d = toDescriptor(simpleTool);
    const oai = toOpenAITool(d);
    expect(oai.type).toBe('function');
    expect(oai.function.name).toBe('say_hello');
    expect(oai.function.description).toBe('Say hello to someone');
    expect(oai.function.parameters).toBe(d.parameters);
  });
});

// ── toAnthropicTool ───────────────────────────────────────────────────────────

describe('toAnthropicTool', () => {
  it('formats a descriptor for the Anthropic Messages API', () => {
    const d = toDescriptor(simpleTool);
    const ant = toAnthropicTool(d);
    expect(ant.name).toBe('say_hello');
    expect(ant.description).toBe('Say hello to someone');
    expect(ant.input_schema).toBe(d.parameters);
  });
});

// ── toGeminiTool ──────────────────────────────────────────────────────────────

describe('toGeminiTool', () => {
  it('formats a descriptor for the Gemini API', () => {
    const d = toDescriptor(simpleTool);
    const gem = toGeminiTool(d);
    expect(gem.name).toBe('say_hello');
    expect(gem.description).toBe('Say hello to someone');
    expect(gem.parameters).toBe(d.parameters);
  });
});
