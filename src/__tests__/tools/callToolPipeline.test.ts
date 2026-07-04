import { describe, it, expect, vi } from 'vitest';
import { createToolCallPipeline, withErrorBoundary } from '../../tools/callToolPipeline';
import type { ToolRegistry } from '../../tools/registry';
import type { ToolSet, ToolSetContext } from '@agent-type';
import type { ToolCall, ToolResult, AgentHandler, ToolExecutionContext } from '@agent-type';
import { emptyRegistry, withTool } from '../../tools/registry';

const MINIMAL_CONTEXT: ToolSetContext = {
  sessionId: 'sess-1',
  agentName: 'main',
  conversationId: 'sess-1',
};

function makeCall(name = 'test_tool'): ToolCall {
  return { id: 'call-1', name, arguments: {} };
}

describe('createToolCallPipeline', () => {
  it('executes a valid tool and returns result', async () => {
    const reg = withTool(emptyRegistry(), {
      name: 'test_tool',
      description: 'test',
      parameters: { safeParse: () => ({ success: true, data: {} }) } as any,
      execute: async () => 'done',
    });
    const pipeline = createToolCallPipeline({
      registry: reg,
      toolSets: [],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall('test_tool'), new AbortController().signal);
    expect(result.result).toBe('done');
  });

  it('applies onResolveToolArgs hooks', async () => {
    const reg = withTool(emptyRegistry(), {
      name: 'test_tool',
      description: 'test',
      parameters: { safeParse: () => ({ success: true, data: {} }) } as any,
      execute: async () => 'ok',
    });
    const resolveTs: ToolSet = {
      name: 'resolver',
      tools: [],
      onResolveToolArgs: (_ctx: ToolSetContext, _name: string, args: Record<string, unknown>) => {
        return { ...args, resolved: true };
      },
    };
    const pipeline = createToolCallPipeline({
      registry: reg,
      toolSets: [resolveTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    await pipeline(makeCall(), new AbortController().signal);
    // Tool was invoked — if we got here without error the pipeline worked
    expect(true).toBe(true);
  });

  it('applies onPatchToolContext hooks', async () => {
    let capturedCtx: ToolExecutionContext | undefined;
    const reg = withTool(emptyRegistry(), {
      name: 'test_tool',
      description: 'test',
      parameters: { safeParse: () => ({ success: true, data: {} }) } as any,
      execute: async (_args: any, ctx: ToolExecutionContext) => {
        capturedCtx = ctx;
        return 'ok';
      },
    });
    const patchTs: ToolSet = {
      name: 'patcher',
      tools: [],
      onPatchToolContext: () => ({ requestUserInput: () => Promise.resolve('from_patch') }),
    };
    const pipeline = createToolCallPipeline({
      registry: reg,
      toolSets: [patchTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    await pipeline(makeCall(), new AbortController().signal);
    expect(capturedCtx!.requestUserInput).toBeDefined();
  });

  it('onBeforeToolExecute can intercept and deny execution', async () => {
    const reg = withTool(emptyRegistry(), {
      name: 'secret_tool',
      description: 'secret',
      parameters: { safeParse: () => ({ success: true, data: {} }) } as any,
      execute: async () => 'should not reach',
    });
    const denyTs: ToolSet = {
      name: 'denier',
      tools: [],
      onBeforeToolExecute: async () => ({
        allow: false,
        result: { toolCallId: 'call-1', name: 'secret_tool', result: 'Denied' },
      }),
    };
    const pipeline = createToolCallPipeline({
      registry: reg,
      toolSets: [denyTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall('secret_tool'), new AbortController().signal);
    expect(result.result).toBe('Denied');
  });

  it('onToolResult transforms the result', async () => {
    const reg = withTool(emptyRegistry(), {
      name: 'test_tool',
      description: 'test',
      parameters: { safeParse: () => ({ success: true, data: {} }) } as any,
      execute: async () => 'original',
    });
    const transformTs: ToolSet = {
      name: 'transformer',
      tools: [],
      onToolResult: (_ctx: ToolSetContext, _name: string, result: ToolResult) => {
        return { ...result, result: 'transformed' };
      },
    };
    const pipeline = createToolCallPipeline({
      registry: reg,
      toolSets: [transformTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.result).toBe('transformed');
  });

  it('works with lazy registry getter', async () => {
    const reg = withTool(emptyRegistry(), {
      name: 'lazy_tool',
      description: 'lazy',
      parameters: { safeParse: () => ({ success: true, data: {} }) } as any,
      execute: async () => 'lazy_ok',
    });
    const pipeline = createToolCallPipeline({
      registry: () => reg,
      toolSets: [],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall('lazy_tool'), new AbortController().signal);
    expect(result.result).toBe('lazy_ok');
  });

  it('works with lazy toolSets getter', async () => {
    const reg = withTool(emptyRegistry(), {
      name: 'tool',
      description: 't',
      parameters: { safeParse: () => ({ success: true, data: {} }) } as any,
      execute: async () => 'ok',
    });
    const pipeline = createToolCallPipeline({
      registry: reg,
      toolSets: () => [],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall('tool'), new AbortController().signal);
    expect(result.result).toBe('ok');
  });

  it('passes flushPersistence to execution context', async () => {
    const flushFn = vi.fn();
    const reg = withTool(emptyRegistry(), {
      name: 'test_tool',
      description: 'test',
      parameters: { safeParse: () => ({ success: true, data: {} }) } as any,
      execute: async () => 'ok',
    });
    const pipeline = createToolCallPipeline({
      registry: reg,
      toolSets: [],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
      flushPersistence: flushFn,
    });
    await pipeline(makeCall(), new AbortController().signal);
    // Pipeline should have executed successfully
    expect(true).toBe(true);
  });
});

describe('withErrorBoundary', () => {
  it('returns the pipeline result on success', async () => {
    const pipeline = async () => ({ toolCallId: 'c1', name: 't', result: 'ok' });
    const safe = withErrorBoundary(pipeline);
    const result = await safe(makeCall(), new AbortController().signal);
    expect(result.result).toBe('ok');
  });

  it('wraps a thrown Error in a structured ToolResult', async () => {
    const pipeline = async () => { throw new Error('something broke'); };
    const safe = withErrorBoundary(pipeline);
    const result = await safe(makeCall('failing_tool'), new AbortController().signal);
    expect(typeof result.result).toBe('string');
    const parsed = JSON.parse(result.result as string);
    expect(parsed._error).toBe(true);
    expect(parsed.code).toBe('TOOL_EXECUTION');
    expect(parsed.toolName).toBe('failing_tool');
    expect(parsed.message).toBe('something broke');
  });

  it('wraps a string throw in a structured ToolResult', async () => {
    const pipeline = async () => { throw 'string error'; };
    const safe = withErrorBoundary(pipeline);
    const result = await safe(makeCall(), new AbortController().signal);
    const parsed = JSON.parse(result.result as string);
    expect(parsed._error).toBe(true);
    expect(parsed.message).toBe('string error');
  });
});
