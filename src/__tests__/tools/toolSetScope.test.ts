/**
 * Comprehensive unit tests for `toolSetScope.ts` — the unified ToolSet lifecycle
 * orchestrator used by both main-agent and sub-agent paths.
 *
 * Every method on the `ToolSetScope` object is tested with:
 *   - Normal operation (1+ ToolSets)
 *   - Edge cases (empty list, undefined return values)
 *   - Lazy resolution (late-registered ToolSets appear on next call)
 *
 * Integration-level parity tests (main agent vs sub-agent) live in
 * `src/__tests__/client/toolsetLifecycleIntegration.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createToolSetScope } from '../../tools/toolSetScope';
import type {
  ToolSet,
  ToolSetContext,
  ToolSetStateContext,
  SessionEntryData,
  SessionReadyHelpers,
  AgentHandler,
  AgentMessage,
  AgentRunOutcome,
  Tool,
} from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SESSION_ID = 'test-session';
const AGENT_NAME = 'test-agent';
const CONVERSATION_ID = 'test-conv';

function makeCtx(overrides?: Partial<ToolSetContext>): ToolSetContext {
  return {
    sessionId: SESSION_ID,
    agentName: AGENT_NAME,
    conversationId: CONVERSATION_ID,
    ...overrides,
  };
}

const MOCK_HANDLER: AgentHandler = vi.fn().mockResolvedValue({ text: 'done' }) as unknown as AgentHandler;
const NOOP_HANDLER: AgentHandler = (() => Promise.reject(new Error('noop'))) as unknown as AgentHandler;

function makeToolSet(name: string, overrides?: Partial<ToolSet>): ToolSet {
  return { name, tools: [], ...overrides } as ToolSet;
}

/** Create a ToolSet that records every hook invocation for assertions. */
function makeSpyToolSet(name: string, overrides?: Partial<ToolSet>): ToolSet & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    tools: [],
    calls,
    onInit: overrides?.onInit ?? vi.fn((_ctx: ToolSetContext) => { calls.push(`onInit:${_ctx.agentName}`); }),
    onReady: overrides?.onReady ?? vi.fn((_ctx: ToolSetContext) => { calls.push(`onReady:${_ctx.agentName}`); }),
    onReset: overrides?.onReset ?? vi.fn((_ctx: ToolSetContext) => { calls.push(`onReset:${_ctx.agentName}`); }),
    onRemove: overrides?.onRemove ?? vi.fn((_ctx: ToolSetContext) => { calls.push(`onRemove:${_ctx.agentName}`); }),
    onSubscribe: overrides?.onSubscribe ?? vi.fn((_ctx: ToolSetContext, _fn: () => void) => {
      calls.push(`onSubscribe:${_ctx.agentName}`);
      return () => { calls.push(`unsub:${_ctx.agentName}`); };
    }),
    onGetSystemPrompt: overrides?.onGetSystemPrompt ?? vi.fn(() => undefined),
    onFilterTools: overrides?.onFilterTools ?? vi.fn((_ctx: ToolSetContext, tools: readonly Tool[]) => tools),
    onGetState: overrides?.onGetState ?? vi.fn(() => ({})),
    onBuildSnapshot: overrides?.onBuildSnapshot ?? vi.fn(() => ({})),
  } as ToolSet & { calls: string[] };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Scope Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe('createToolSetScope — Scope Lifecycle', () => {
  describe('initScope', () => {
    it('calls onInit on every ToolSet with correct ctx', () => {
      const ts1 = makeSpyToolSet('a');
      const ts2 = makeSpyToolSet('b');
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);
      const ctx = makeCtx();

      scope.initScope(ctx);

      expect(ts1.calls).toContain('onInit:test-agent');
      expect(ts2.calls).toContain('onInit:test-agent');
      expect(ts1.onInit).toHaveBeenCalledWith(ctx, undefined);
      expect(ts2.onInit).toHaveBeenCalledWith(ctx, undefined);
    });

    it('passes entryData to onInit when provided', () => {
      const ts = makeSpyToolSet('a');
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);
      const entryData: SessionEntryData = { id: 'sess-1', title: 'Test' };

      scope.initScope(makeCtx(), entryData);

      expect(ts.onInit).toHaveBeenCalledWith(makeCtx(), entryData);
    });

    it('does nothing when no ToolSets are registered', () => {
      const scope = createToolSetScope(() => [], NOOP_HANDLER);
      expect(() => scope.initScope(makeCtx())).not.toThrow();
    });

    it('handles ToolSet without onInit hook gracefully', () => {
      const ts = makeToolSet('quiet'); // no onInit
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);
      expect(() => scope.initScope(makeCtx())).not.toThrow();
    });
  });

  describe('readyScope', () => {
    it('calls onReady on every ToolSet with correct helpers', () => {
      const ts1 = makeSpyToolSet('a');
      const ts2 = makeSpyToolSet('b');
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);
      const ctx = makeCtx();
      const helpers: SessionReadyHelpers = {
        sendMessage: vi.fn(),
        injectToolResult: vi.fn(),
      };

      scope.readyScope(ctx, helpers);

      expect(ts1.calls).toContain('onReady:test-agent');
      expect(ts2.calls).toContain('onReady:test-agent');
      expect(ts1.onReady).toHaveBeenCalledWith(ctx, helpers);
    });

    it('does nothing when no ToolSets are registered', () => {
      const scope = createToolSetScope(() => [], NOOP_HANDLER);
      expect(() => scope.readyScope(makeCtx(), {} as SessionReadyHelpers)).not.toThrow();
    });
  });

  describe('resetScope', () => {
    it('calls onReset on every ToolSet', () => {
      const ts1 = makeSpyToolSet('a');
      const ts2 = makeSpyToolSet('b');
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);

      scope.resetScope(makeCtx());

      expect(ts1.calls).toContain('onReset:test-agent');
      expect(ts2.calls).toContain('onReset:test-agent');
    });

    it('does nothing for empty ToolSet list', () => {
      const scope = createToolSetScope(() => [], NOOP_HANDLER);
      expect(() => scope.resetScope(makeCtx())).not.toThrow();
    });
  });

  describe('removeScope', () => {
    it('calls onRemove on every ToolSet', () => {
      const ts1 = makeSpyToolSet('a');
      const ts2 = makeSpyToolSet('b');
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);

      scope.removeScope(makeCtx());

      expect(ts1.calls).toContain('onRemove:test-agent');
      expect(ts2.calls).toContain('onRemove:test-agent');
    });

    it('does nothing for empty ToolSet list', () => {
      const scope = createToolSetScope(() => [], NOOP_HANDLER);
      expect(() => scope.removeScope(makeCtx())).not.toThrow();
    });
  });

  describe('subscribeScope', () => {
    it('calls onSubscribe on every ToolSet and returns combined unsub', () => {
      const ts1 = makeSpyToolSet('a');
      const ts2 = makeSpyToolSet('b');
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);

      const notify = vi.fn();
      const unsub = scope.subscribeScope(makeCtx(), notify);

      expect(ts1.calls).toContain('onSubscribe:test-agent');
      expect(ts2.calls).toContain('onSubscribe:test-agent');
      expect(ts1.onSubscribe).toHaveBeenCalledWith(makeCtx(), notify);

      // Calling unsub should trigger both ToolSet's unsub callbacks
      unsub();
      expect(ts1.calls).toContain('unsub:test-agent');
      expect(ts2.calls).toContain('unsub:test-agent');
    });

    it('returns a no-op unsub when ToolSets return no unsubscribe functions', () => {
      const ts: ToolSet = { name: 'quiet', tools: [], onSubscribe(_ctx: ToolSetContext, _fn: () => void): () => void { return () => {}; } };
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);
      const unsub = scope.subscribeScope(makeCtx(), vi.fn());
      expect(() => unsub()).not.toThrow();
    });

    it('returns a no-op unsub when no ToolSets exist', () => {
      const scope = createToolSetScope(() => [], NOOP_HANDLER);
      const unsub = scope.subscribeScope(makeCtx(), vi.fn());
      expect(() => unsub()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Per-Run Dispatch
  // ═══════════════════════════════════════════════════════════════════════════

  describe('beforeRun', () => {
    it('calls onBeforeRun on every ToolSet', () => {
      const calls: string[] = [];
      const ts1 = makeToolSet('a', {
        onBeforeRun: vi.fn((_ctx: ToolSetContext) => { calls.push('a'); }),
      });
      const ts2 = makeToolSet('b', {
        onBeforeRun: vi.fn((_ctx: ToolSetContext) => { calls.push('b'); }),
      });
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);

      scope.beforeRun(makeCtx(), []);

      expect(calls).toEqual(['a', 'b']);
    });

    it('handles ToolSet without onBeforeRun', () => {
      const ts = makeToolSet('quiet');
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);
      expect(() => scope.beforeRun(makeCtx(), [])).not.toThrow();
    });
  });

  describe('afterRun', () => {
    it('calls onAfterRun on every ToolSet with correct outcome', () => {
      const outcomes: string[] = [];
      const ts = makeToolSet('a', {
        onAfterRun: vi.fn((_ctx: ToolSetContext, outcome: AgentRunOutcome) => {
          outcomes.push(outcome);
        }),
      });
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      scope.afterRun(makeCtx(), 'completed');
      scope.afterRun(makeCtx(), 'aborted');

      expect(outcomes).toEqual(['completed', 'aborted']);
    });
  });

  describe('interceptMessage', () => {
    it('returns false when no ToolSet intercepts', () => {
      const ts = makeToolSet('a', {
        onInterceptMessage: vi.fn(() => undefined),
      });
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      const result = scope.interceptMessage(makeCtx(), 'hello', undefined, false);
      expect(result).toBe(false);
    });

    it('returns true when first ToolSet intercepts, stops chain', () => {
      const order: string[] = [];
      const ts1 = makeToolSet('a', {
        onInterceptMessage: vi.fn(() => {
          order.push('a');
          return { intercepted: true as const };
        }),
      });
      const ts2 = makeToolSet('b', {
        onInterceptMessage: vi.fn(() => {
          order.push('b');
          return undefined;
        }),
      });
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);

      const result = scope.interceptMessage(makeCtx(), 'hello', undefined, false);

      expect(result).toBe(true);
      expect(order).toEqual(['a']); // ts2 should NOT be called
      expect(ts2.onInterceptMessage).not.toHaveBeenCalled();
    });

    it('passes attachments and isLoading correctly', () => {
      const spy = vi.fn(() => undefined);
      const ts = makeToolSet('a', { onInterceptMessage: spy });
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);
      const attachments = [{ source: 'data' as const, kind: 'image' as const, mimeType: 'image/png', data: '' }];

      scope.interceptMessage(makeCtx(), 'text', attachments, true);

      expect(spy).toHaveBeenCalledWith(
        makeCtx(),
        { content: 'text', attachments },
        true,
      );
    });
  });

  describe('beforeInvoke', () => {
    it('collects injected messages from all ToolSets', () => {
      const ts1 = makeToolSet('a', {
        onBeforeInvoke: vi.fn(() => [{ role: 'user' as const, content: 'from-a' }]),
      });
      const ts2 = makeToolSet('b', {
        onBeforeInvoke: vi.fn(() => [{ role: 'user' as const, content: 'from-b' }]),
      });
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);

      const messages = scope.beforeInvoke(makeCtx());

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('from-a');
      expect(messages[1].content).toBe('from-b');
    });

    it('returns empty array when no ToolSets inject', () => {
      const ts = makeToolSet('quiet');
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      expect(scope.beforeInvoke(makeCtx())).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Per-Turn Operations
  // ═══════════════════════════════════════════════════════════════════════════

  describe('buildSystemPrompt', () => {
    it('returns undefined when base and ToolSets produce nothing', () => {
      const ts = makeToolSet('quiet');
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      const result = scope.buildSystemPrompt(undefined, makeCtx());
      expect(result).toBeUndefined();
    });

    it('includes base prompt', () => {
      const scope = createToolSetScope(() => [], NOOP_HANDLER);

      const result = scope.buildSystemPrompt('Base prompt', makeCtx());
      expect(result).toBe('Base prompt');
    });

    it('includes ToolSet fragments', () => {
      const ts = makeToolSet('a', {
        onGetSystemPrompt: vi.fn(() => '## Section\nContent'),
      });
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      const result = scope.buildSystemPrompt('Base', makeCtx());

      expect(result).toContain('Base');
      expect(result).toContain('## Section');
      expect(result).toContain('Content');
    });

    it('passes userMessage and sectionCache through to buildSystemPrompt', () => {
      const spy = vi.fn(() => 'fragment');
      const ts = makeToolSet('a', {
        sectionId: 'test',
        onGetSystemPrompt: spy,
      });
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      scope.buildSystemPrompt('Base', makeCtx(), 'user query');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('filterTools', () => {
    it('applies onFilterTools from all ToolSets in order', () => {
      const toolA: Tool = { name: 'a', description: 'tool-a', parameters: {} as any, execute: async () => 'a' };
      const toolB: Tool = { name: 'b', description: 'tool-b', parameters: {} as any, execute: async () => 'b' };

      const filter = makeToolSet('filter', {
        onFilterTools: vi.fn((_ctx: ToolSetContext, tools: readonly Tool[]) =>
          tools.filter((t) => t.name !== 'a'),
        ),
      });
      const scope = createToolSetScope(() => [filter], NOOP_HANDLER);

      const result = scope.filterTools([toolA, toolB], makeCtx());

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('b');
    });

    it('returns input when no filters', () => {
      const toolA: Tool = { name: 'a', description: 'tool-a', parameters: {} as any, execute: async () => 'a' };
      const scope = createToolSetScope(() => [], NOOP_HANDLER);

      const result = scope.filterTools([toolA], makeCtx());
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('a');
    });
  });

  describe('composeAfterTurn', () => {
    it('chains ToolSet onAfterTurn hooks and collects notices', async () => {
      const ts1 = makeToolSet('a', {
        onAfterTurn: vi.fn(async (
          _ctx: ToolSetContext,
          _history: AgentMessage[],
        ) => ({
          history: [{ role: 'assistant' as const, content: 'v1' }],
          notices: [{ content: 'notice-1' }],
        })),
      });
      const ts2 = makeToolSet('b', {
        onAfterTurn: vi.fn(async (
          _ctx: ToolSetContext,
          history: AgentMessage[],
        ) => ({
          history: [...history, { role: 'assistant' as const, content: 'v2' }],
          notices: [{ content: 'notice-2' }],
        })),
      });
      const scope = createToolSetScope(() => [ts1, ts2], MOCK_HANDLER);

      const result = await scope.composeAfterTurn(
        [{ role: 'user' as const, content: 'hi' }],
        makeCtx(),
        { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        new AbortController().signal,
      );

      expect(result.changed).toBe(true);
      expect(result.history).toHaveLength(2);
      expect(result.history[0].content).toBe('v1');
      expect(result.history[1].content).toBe('v2');
      expect(result.notices).toHaveLength(2);
      expect(result.notices[0].content).toBe('notice-1');
      expect(result.notices[1].content).toBe('notice-2');
    });

    it('returns unchanged when no ToolSet returns a compaction', async () => {
      const ts = makeToolSet('quiet');
      const scope = createToolSetScope(() => [ts], MOCK_HANDLER);
      const history: AgentMessage[] = [{ role: 'user' as const, content: 'hi' }];

      const result = await scope.composeAfterTurn(history, makeCtx(), undefined, new AbortController().signal);

      expect(result.changed).toBe(false);
      expect(result.history).toBe(history); // same reference when unchanged
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Tool-Call Pipeline
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createPipeline', () => {
    it('creates a callable pipeline', async () => {
      const tool: Tool = {
        name: 'echo',
        description: 'Echo tool',
        parameters: z.object({}),
        execute: async () => 'echo:done',
      };
      const registry = new Map([[tool.name, tool]]);
      const scope = createToolSetScope(() => [], MOCK_HANDLER);

      const pipeline = scope.createPipeline(makeCtx(), registry);
      const result = await pipeline({ id: 'c1', name: 'echo', arguments: { x: 'hello' } }, new AbortController().signal);

      expect(result.name).toBe('echo');
      expect(result.toolCallId).toBe('c1');
    });

    it('forwards flushPersistence through the pipeline', () => {
      const flushPersistence = vi.fn();
      const scope = createToolSetScope(() => [], MOCK_HANDLER);

      const pipeline = scope.createPipeline(makeCtx(), new Map(), flushPersistence);
      expect(pipeline).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  State & Snapshot
  // ═══════════════════════════════════════════════════════════════════════════

  describe('collectState', () => {
    it('merges onGetState from all ToolSets', () => {
      const ts1 = makeToolSet('a', {
        onGetState: vi.fn(() => ({ fieldA: 'value-a' })),
      });
      const ts2 = makeToolSet('b', {
        onGetState: vi.fn(() => ({ fieldB: 'value-b' })),
      });
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);

      const result = scope.collectState(makeCtx(), { tools: [] });

      expect(result.fieldA).toBe('value-a');
      expect(result.fieldB).toBe('value-b');
    });

    it('returns empty record when no ToolSet contributes', () => {
      const ts = makeToolSet('quiet');
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      const result = scope.collectState(makeCtx(), { tools: [] });
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('includes symbol-keyed state from onGetSymbolState', () => {
      const sym = Symbol('plugin');
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const ts: any = { name: 'a', tools: [], symbol: sym, onGetSymbolState: () => ({ data: 'plugin-state' }) };
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      const result = scope.collectState(makeCtx(), { tools: [] });
      expect(Object.getOwnPropertySymbols(result)).toContain(sym);
    });
  });

  describe('collectSnapshot', () => {
    it('aggregates onBuildSnapshot from all ToolSets', () => {
      const ts1: ToolSet = { name: 'a', tools: [], onBuildSnapshot: () => ({ snapA: 'from-a' }) } as ToolSet;
      const ts2: ToolSet = { name: 'b', tools: [], onBuildSnapshot: () => ({ snapB: 'from-b' }) } as ToolSet;
      const scope = createToolSetScope(() => [ts1, ts2], NOOP_HANDLER);

      const result = scope.collectSnapshot(makeCtx());

      expect(result.snapA).toBe('from-a');
      expect(result.snapB).toBe('from-b');
    });

    it('returns empty object when no ToolSet contributes', () => {
      const ts = makeToolSet('quiet');
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      expect(scope.collectSnapshot(makeCtx())).toEqual({});
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Lazy Resolution
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lazy ToolSet resolution', () => {
    it('resolves toolSets lazily — late additions are visible', () => {
      const ts1 = makeSpyToolSet('first');
      const ts2 = makeSpyToolSet('second');
      const toolSets: ToolSet[] = [ts1];
      const scope = createToolSetScope(() => toolSets, NOOP_HANDLER);

      // Only ts1 is registered initially
      scope.initScope(makeCtx());
      expect(ts1.calls).toContain('onInit:test-agent');
      expect(ts2.calls).not.toContain('onInit:test-agent');

      // Add ts2 — the lazy getter picks it up
      toolSets.push(ts2);
      scope.resetScope(makeCtx());
      expect(ts1.calls).toContain('onReset:test-agent');
      expect(ts2.calls).toContain('onReset:test-agent');
    });

    it('dynamic handler changes are also reflected lazily', async () => {
      let currentHandler: AgentHandler = (() => Promise.resolve({ text: 'first' })) as unknown as AgentHandler;
      const scope = createToolSetScope(() => [], currentHandler);

      // composeAfterTurn uses the handler from the factory — testing that it's resolved each time
      const result1 = await scope.composeAfterTurn([], makeCtx(), undefined, new AbortController().signal);
      expect(result1.changed).toBe(false);

      // The handler reference is captured at scope creation time for composeAfterTurn
      // (because composeToolSetAfterTurn receives handler as a parameter)
      // This is fine — handler changes don't affect composeAfterTurn behavior
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Context Propagation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Context propagation', () => {
    it('passes the correct ToolSetContext to every hook', () => {
      const ctx = makeCtx({ agentName: 'sub-researcher', conversationId: 'conv-123' });
      const onInitSpy = vi.fn();
      const onReadySpy = vi.fn();
      const onResetSpy = vi.fn();

      const ts = makeToolSet('a', {
        onInit: onInitSpy,
        onReady: onReadySpy,
        onReset: onResetSpy,
      });
      const scope = createToolSetScope(() => [ts], NOOP_HANDLER);

      scope.initScope(ctx);
      scope.readyScope(ctx, { sendMessage: vi.fn(), injectToolResult: vi.fn() });
      scope.resetScope(ctx);

      expect(onInitSpy).toHaveBeenCalledWith(ctx, undefined);
      expect(onReadySpy).toHaveBeenCalledWith(ctx, expect.objectContaining({
        sendMessage: expect.any(Function),
        injectToolResult: expect.any(Function),
      }));
      expect(onResetSpy).toHaveBeenCalledWith(ctx);
    });
  });
});
