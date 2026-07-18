/**
 * Unit tests for callToolPipeline null/undefined guards.
 *
 * Verifies that the pipeline never throws "Cannot convert undefined or null to
 * object" (V8 TypeError from for...of / Object.* on null) regardless of how
 * toolSets or tool arguments are supplied at runtime.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createToolCallPipeline, withErrorBoundary } from '../../tools/callToolPipeline';
import type { ToolRegistry } from '../../tools/registry';
import type { ToolSet, ToolSetContext, Tool, ToolExecutionContext } from '@agent-type';
import type { ToolCall, ToolResult } from '@agent-type';
import { emptyRegistry, withTool } from '../../tools/registry';
import { z } from 'zod';

const MINIMAL_CONTEXT: ToolSetContext = {
  sessionId: 'sess-1',
  agentName: 'main',
  conversationId: 'sess-1',
};

const DUMMY_TOOL = {
  name: 'test_tool',
  description: 'a test tool',
  parameters: z.object({ msg: z.string().optional() }),
  execute: async (_params: unknown, _ctx: ToolExecutionContext) => {
    const { msg } = _params as { msg?: string };
    return (msg ?? 'ok') as unknown;
  },
} satisfies Tool;

function makeCall(name = 'test_tool', args: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name, arguments: args };
}

describe('callToolPipeline — null/undefined guards', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = withTool(emptyRegistry(), DUMMY_TOOL);
  });

  // ── toolSets getter returns null ──────────────────────────────────────────

  it('handles toolSets getter returning null', async () => {
    const pipeline = createToolCallPipeline({
      registry,
      toolSets: () => null as unknown as readonly ToolSet[],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    // Should not throw "Cannot convert undefined or null to object"
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.toolCallId).toBe('call-1');
    expect(result.name).toBe('test_tool');
  });

  // ── toolSets getter returns undefined ─────────────────────────────────────

  it('handles toolSets getter returning undefined', async () => {
    const pipeline = createToolCallPipeline({
      registry,
      toolSets: () => undefined as unknown as readonly ToolSet[],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.toolCallId).toBe('call-1');
  });

  // ── toolSets is null directly (not a function) ────────────────────────────

  it('handles toolSets being null directly', async () => {
    const pipeline = createToolCallPipeline({
      registry,
      toolSets: null as unknown as readonly ToolSet[],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.toolCallId).toBe('call-1');
  });

  // ── toolSets is undefined directly ────────────────────────────────────────

  it('handles toolSets being undefined directly', async () => {
    const pipeline = createToolCallPipeline({
      registry,
      toolSets: undefined as unknown as readonly ToolSet[],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.toolCallId).toBe('call-1');
  });

  // ── call.arguments is null ─────────────────────────────────────────────────

  it('handles null arguments via safeArgs fallback to {}', async () => {
    const reg = withTool(emptyRegistry(), {
      name: 'empty_tool',
      description: 'accepts empty args',
      parameters: z.object({}),
      execute: async () => 'ok_null',
    });
    const pipeline = createToolCallPipeline({
      registry: reg,
      toolSets: [],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const nullArgsCall: ToolCall = { id: 'call-null', name: 'empty_tool', arguments: null as unknown as Record<string, unknown> };
    const result = await pipeline(nullArgsCall, new AbortController().signal);
    expect(result.toolCallId).toBe('call-null');
    expect(result.result).toBe('ok_null');
  });

  // ── call.arguments is undefined ───────────────────────────────────────────

  it('handles undefined arguments via safeArgs fallback to {}', async () => {
    const reg = withTool(emptyRegistry(), {
      name: 'empty_tool2',
      description: 'accepts empty args',
      parameters: z.object({}),
      execute: async () => 'ok_undef',
    });
    const pipeline = createToolCallPipeline({
      registry: reg,
      toolSets: [],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const undefArgsCall: ToolCall = { id: 'call-undef', name: 'empty_tool2', arguments: undefined as unknown as Record<string, unknown> };
    const result = await pipeline(undefArgsCall, new AbortController().signal);
    expect(result.toolCallId).toBe('call-undef');
    expect(result.result).toBe('ok_undef');
  });

  // ── ToolSet with null tools array ─────────────────────────────────────────

  it('handles ToolSet with null tools array in runtime', async () => {
    const badTs: ToolSet = {
      name: 'bad_ts',
      tools: null as unknown as readonly Tool[],
    };
    const pipeline = createToolCallPipeline({
      registry,
      toolSets: [badTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    // Should still execute the tool; the tools field is only used by
    // other parts of the system (tool registration), not by the pipeline.
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.toolCallId).toBe('call-1');
  });

  // ── withErrorBoundary catches TypeError from internal error ───────────────

  it('withErrorBoundary catches TypeError and returns structured error', async () => {
    const throwingPipeline = async (_call: ToolCall, _signal: AbortSignal) => {
      throw new TypeError('Cannot convert undefined or null to object');
    };
    const safe = withErrorBoundary(throwingPipeline);
    const result = await safe(makeCall(), new AbortController().signal);
    expect(result.result).toContain('_error');
    expect(result.result).toContain('TOOL_EXECUTION');
    expect(result.result).toContain('Cannot convert undefined or null to object');
  });

  // ── withErrorBoundary handles non-Error throws ────────────────────────────

  it('withErrorBoundary catches string throws gracefully', async () => {
    const throwingPipeline = async (_call: ToolCall, _signal: AbortSignal) => {
      // eslint-disable-next-line no-throw-literal
      throw 'something went wrong';
    };
    const safe = withErrorBoundary(throwingPipeline);
    const result = await safe(makeCall(), new AbortController().signal);
    expect(result.result).toContain('TOOL_EXECUTION');
    expect(result.result).toContain('something went wrong');
  });
});

describe('callToolPipeline — onBeforeToolExecute null return', () => {
  it('handles onBeforeToolExecute returning null gracefully', async () => {
    const registry = withTool(emptyRegistry(), DUMMY_TOOL);
    const nullReturnTs: ToolSet = {
      name: 'null_return',
      tools: [],
      onBeforeToolExecute: async () => null as unknown as { allow: boolean; result: ToolResult },
    };
    const pipeline = createToolCallPipeline({
      registry,
      toolSets: [nullReturnTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.toolCallId).toBe('call-1');
    expect(result.result).toBe('ok');
  });
});

describe('callToolPipeline — onPatchToolContext null/undefined', () => {
  it('handles onPatchToolContext returning null', async () => {
    const registry = withTool(emptyRegistry(), DUMMY_TOOL);
    const nullPatchTs: ToolSet = {
      name: 'null_patch',
      tools: [],
      onPatchToolContext: () => null as unknown as Partial<ToolExecutionContext>,
    };
    const pipeline = createToolCallPipeline({
      registry,
      toolSets: [nullPatchTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.result).toBe('ok');
  });

  it('handles onPatchToolContext returning undefined', async () => {
    const registry = withTool(emptyRegistry(), DUMMY_TOOL);
    const undefPatchTs: ToolSet = {
      name: 'undef_patch',
      tools: [],
      onPatchToolContext: () => undefined,
    };
    const pipeline = createToolCallPipeline({
      registry,
      toolSets: [undefPatchTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.result).toBe('ok');
  });
});
describe('callToolPipeline — onToolResult null/undefined', () => {
  it('handles onToolResult returning null gracefully', async () => {
    const nullResultTs: ToolSet = {
      name: 'null_result',
      tools: [],
      onToolResult: () => null as unknown as ToolResult,
    };
    const pipeline = createToolCallPipeline({
      registry: withTool(emptyRegistry(), DUMMY_TOOL),
      toolSets: [nullResultTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.toolCallId).toBe('call-1');
    expect(result.result).toBe('ok');
  });

  it('handles onToolResult returning undefined gracefully', async () => {
    const undefResultTs: ToolSet = {
      name: 'undef_result',
      tools: [],
      onToolResult: () => undefined as unknown as ToolResult,
    };
    const pipeline = createToolCallPipeline({
      registry: withTool(emptyRegistry(), DUMMY_TOOL),
      toolSets: [undefResultTs],
      ctx: MINIMAL_CONTEXT,
      handler: vi.fn(),
    });
    const result = await pipeline(makeCall(), new AbortController().signal);
    expect(result.toolCallId).toBe('call-1');
    expect(result.result).toBe('ok');
  });
});