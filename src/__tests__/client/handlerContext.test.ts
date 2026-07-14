import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildHandlerContext } from '../../client/handlerContext';
import { createToolManager } from '../../client/toolManager';
import { createToolCallPipeline } from '../../tools/callToolPipeline';
import type { Tool } from '@agent-type';
import type { ToolSet, ToolSetContext, SystemPromptContext } from '@agent-type';
import { MAIN_CONVERSATION_ID } from '../../tools/toolSet';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTool(name: string, group?: string): Tool {
  return {
    name,
    description: `tool-${name}`,
    parameters: z.object({ x: z.string().optional() }),
    group,
    execute: async () => `result-${name}`,
  };
}

/** Create a minimal ToolSet that injects a fixed system-prompt fragment. */
function makePromptToolSet(name: string, fragment: string, options?: {
  keyword?: string;
}): ToolSet {
  return {
    name,
    tools: [],
    onGetSystemPrompt(_ctx: ToolSetContext, promptCtx: SystemPromptContext): string | undefined {
      if (options?.keyword && promptCtx.userMessage !== undefined && !promptCtx.userMessage.includes(options.keyword)) {
        return undefined;
      }
      return fragment;
    },
  };
}

/** Create a minimal ToolSet that filters out specific tools by name. */
function makeFilterToolSet(disabledNames: ReadonlySet<string>): ToolSet {
  return {
    name: 'mockFilter',
    tools: [],
    onFilterTools(_ctx: ToolSetContext, tools: readonly Tool[]): readonly Tool[] {
      return tools.filter((t) => !disabledNames.has(t.name));
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const TEST_SIGNAL = new AbortController().signal;

/** Shorthand: build context with default empty toolSets. */
function build(
  tm: ReturnType<typeof createToolManager>,
  systemPrompt?: string,
  toolChoice?: string,
  userMessage?: string,
  toolSets: readonly ToolSet[] = [],
) {
  const pipeline = createToolCallPipeline({
    registry: () => new Map(tm.getTools().map((t) => [t.name, t])),
    toolSets: [...toolSets],
    ctx: { sessionId: 'session-1', agentName: 'main', conversationId: MAIN_CONVERSATION_ID },
    handler: () => Promise.reject(new Error('noop')),
  });
  return buildHandlerContext(tm, systemPrompt, toolChoice as any, 'session-1', 'main', TEST_SIGNAL, userMessage, toolSets, pipeline);
}

describe('buildHandlerContext', () => {
  // ── tools descriptors ──────────────────────────────────────────────────────

  it('returns descriptors for all enabled tools', () => {
    const tm = createToolManager();
    tm.registerTool(makeTool('echo'));
    tm.registerTool(makeTool('ping'));

    const ctx = build(tm);
    expect(ctx.tools.map((t) => t.name)).toContain('echo');
    expect(ctx.tools.map((t) => t.name)).toContain('ping');
  });

  it('excludes disabled tools from the descriptor list via onFilterTools', () => {
    const tm = createToolManager();
    tm.registerTool(makeTool('echo'));
    tm.registerTool(makeTool('ping'));
    const ts = makeFilterToolSet(new Set(['echo']));

    const ctx = build(tm, undefined, undefined, undefined, [ts]);
    expect(ctx.tools.map((t) => t.name)).not.toContain('echo');
    expect(ctx.tools.map((t) => t.name)).toContain('ping');
  });

  // ── systemPrompt ───────────────────────────────────────────────────────────

  it('uses the base systemPrompt when no toolSets are provided', () => {
    const tm = createToolManager();
    const ctx = build(tm, 'Base prompt');
    expect(ctx.systemPrompt).toBe('Base prompt');
  });

  it('appends ToolSet system prompts after the base prompt', () => {
    const tm = createToolManager();
    const ts = makePromptToolSet('web', 'Web prompt');
    const ctx = build(tm, 'Base', undefined, undefined, [ts]);
    expect(ctx.systemPrompt).toContain('Base');
    expect(ctx.systemPrompt).toContain('Web prompt');
  });

  it('returns undefined systemPrompt when base and all ToolSets return nothing', () => {
    const tm = createToolManager();
    const ts: ToolSet = { name: 'silent', tools: [], onGetSystemPrompt: () => undefined };
    const ctx = build(tm, undefined, undefined, undefined, [ts]);
    expect(ctx.systemPrompt).toBeUndefined();
  });

  it('ToolSet can filter injection by userMessage content', () => {
    const tm = createToolManager();
    const tsA = makePromptToolSet('a', 'Prompt A', { keyword: 'alpha' });
    const tsB = makePromptToolSet('b', 'Prompt B', { keyword: 'beta' });

    // only 'alpha' in userMessage → only Prompt A injected
    const ctx = build(tm, undefined, undefined, 'do alpha task', [tsA, tsB]);
    expect(ctx.systemPrompt).toContain('Prompt A');
    expect(ctx.systemPrompt).not.toContain('Prompt B');
  });

  it('headless call (userMessage=undefined) — ToolSet always injects', () => {
    const tm = createToolManager();
    const ts = makePromptToolSet('web', 'Web prompt');
    const ctx = build(tm, 'Base', undefined, undefined, [ts]);
    expect(ctx.systemPrompt).toContain('Web prompt');
  });

  // ── toolChoice ────────────────────────────────────────────────────────────

  it('defaults toolChoice to "auto"', () => {
    const tm = createToolManager();
    const ctx = build(tm);
    expect(ctx.toolChoice).toBe('auto');
  });

  it('uses the provided toolChoice', () => {
    const tm = createToolManager();
    const ctx = build(tm, undefined, 'required');
    expect(ctx.toolChoice).toBe('required');
  });

  // ── callTool ──────────────────────────────────────────────────────────────

  it('callTool executes the tool and returns a result', async () => {
    const tm = createToolManager();
    tm.registerTool(makeTool('echo'));

    const ctx = build(tm);
    const result = await ctx.callTool({ id: 'c1', name: 'echo', arguments: { x: 'hello' } });
    expect(result.result).toBe('result-echo');
  });

  // ── vendor formatters removed ─────────────────────────────────────────────

  it('context.tools contains ToolDescriptor entries for every enabled tool', () => {
    const tm = createToolManager();
    tm.registerTool(makeTool('echo'));
    tm.registerTool(makeTool('ping'));
    const ctx = build(tm);
    expect(ctx.tools).toHaveLength(2);
    expect(ctx.tools[0]).toMatchObject({ name: expect.any(String), description: expect.any(String) });
  });

  it('context has no toOpenAITools / toAnthropicTools / toGeminiTools methods', () => {
    const tm = createToolManager();
    const ctx = build(tm);
    expect((ctx as any).toOpenAITools).toBeUndefined();
    expect((ctx as any).toAnthropicTools).toBeUndefined();
    expect((ctx as any).toGeminiTools).toBeUndefined();
  });

  // ── signal ────────────────────────────────────────────────────────────────

  it('passes the AbortSignal through', () => {
    const tm = createToolManager();
    const signal = new AbortController().signal;
    const pipeline = createToolCallPipeline({
      registry: () => new Map(tm.getTools().map((t) => [t.name, t])),
      toolSets: [],
      ctx: { sessionId: 'session-1', agentName: 'main', conversationId: MAIN_CONVERSATION_ID },
      handler: () => Promise.reject(new Error('noop')),
    });
    const ctx = buildHandlerContext(tm, undefined, undefined, 'session-1', 'main', signal, undefined, [], pipeline);
    expect(ctx.signal).toBe(signal);
  });

  it('context has no toOpenAIMessages / toAnthropicMessages / toGeminiMessages methods', () => {
    const tm = createToolManager();
    const ctx = build(tm);
    expect((ctx as any).toOpenAIMessages).toBeUndefined();
    expect((ctx as any).toAnthropicMessages).toBeUndefined();
    expect((ctx as any).toGeminiMessages).toBeUndefined();
  });
});
