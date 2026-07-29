import { describe, it, expect, vi } from 'vitest';
import { buildSystemPrompt, applyToolFilters, composeToolSetAfterTurn } from '../../tools/agentRuntime';
import { createSystemPromptCache } from '../../tools/prompts/section';
import { MAIN_CONVERSATION_ID } from '../../tools/toolSet';
import type { ToolSet, ToolSetContext, SystemPromptContext, CompactionNotice } from '@agent-type';
import type { Tool, AgentMessage } from '@agent-type';
import type { SectionId } from '@agent-type';

function makeTsCtx(sessionId = 'sess-1'): ToolSetContext {
  return { sessionId, agentName: 'main', conversationId: MAIN_CONVERSATION_ID };
}

function makeToolSet(overrides?: Partial<ToolSet>): ToolSet {
  return {
    name: 'test',
    tools: [],
    ...overrides,
  };
}

/** Test brand symbol for internal ToolSet identification. */
const TEST_BRAND = Symbol('test.internal');

/** Build a ToolSet that carries the test brand — authorised to suppressToolSetPrompt. */
function makeBrandedToolSet(overrides?: Partial<ToolSet>): ToolSet {
  return {
    name: 'branded',
    tools: [],
    [TEST_BRAND]: true as const,
    ...overrides,
  } as ToolSet;
}

describe('buildSystemPrompt', () => {
  it('returns undefined when base and all toolSets return nothing', () => {
    const ts = makeToolSet();
    const result = buildSystemPrompt(undefined, [ts], makeTsCtx());
    expect(result).toBeUndefined();
  });

  it('includes base prompt when provided', () => {
    const result = buildSystemPrompt('Base prompt', [], makeTsCtx());
    expect(result).toBe('Base prompt');
  });

  it('includes fragments from toolSet onGetSystemPrompt', () => {
    const ts = makeToolSet({
      onGetSystemPrompt: () => '## Section\nContent',
    });
    const result = buildSystemPrompt('Base', [ts], makeTsCtx());
    expect(result).toContain('Base');
    expect(result).toContain('## Section');
    expect(result).toContain('Content');
  });

  it('sorts toolSets by sectionPriority ascending', () => {
    const tsLow = makeToolSet({
      sectionId: 'low' as SectionId,
      sectionPriority: 10,
      onGetSystemPrompt: () => 'LOW',
    });
    const tsHigh = makeToolSet({
      sectionId: 'high' as SectionId,
      sectionPriority: 50,
      onGetSystemPrompt: () => 'HIGH',
    });
    const result = buildSystemPrompt(undefined, [tsHigh, tsLow], makeTsCtx());
    const lowIdx = result!.indexOf('LOW');
    const highIdx = result!.indexOf('HIGH');
    expect(lowIdx).toBeLessThan(highIdx);
  });

  it('deduplicates toolSets with the same sectionId (lowest priority wins)', () => {
    const ts1 = makeToolSet({
      sectionId: 'dup' as SectionId,
      sectionPriority: 10,
      onGetSystemPrompt: () => 'FIRST',
    });
    const ts2 = makeToolSet({
      sectionId: 'dup' as SectionId,
      sectionPriority: 20,
      onGetSystemPrompt: () => 'SECOND',
    });
    const result = buildSystemPrompt(undefined, [ts2, ts1], makeTsCtx());
    expect(result).toContain('FIRST');
    expect(result).not.toContain('SECOND');
  });

  it('includes toolSets without sectionId in original order after sorted ones', () => {
    const tsWithSection = makeToolSet({
      sectionId: 'a' as SectionId,
      sectionPriority: 10,
      onGetSystemPrompt: () => 'SECTION',
    });
    const tsWithout1 = makeToolSet({ onGetSystemPrompt: () => 'A' });
    const tsWithout2 = makeToolSet({ onGetSystemPrompt: () => 'B' });
    const result = buildSystemPrompt(undefined, [tsWithout2, tsWithSection, tsWithout1], makeTsCtx());
    const secIdx = result!.indexOf('SECTION');
    const aIdx = result!.indexOf('A');
    const bIdx = result!.indexOf('B');
    expect(secIdx).toBeLessThan(aIdx);
    expect(secIdx).toBeLessThan(bIdx);
    // B before A because the registration order is B → A (tsWithout2 returns B, tsWithout1 returns A)
    expect(bIdx).toBeLessThan(aIdx);
  });

  it('uses sectionCache when sectionId is present', () => {
    const cache = createSystemPromptCache();
    const factory = vi.fn(() => 'Cached section');
    const ts = makeToolSet({
      sectionId: 'cacheable' as SectionId,
      sectionPriority: 10,
      onGetSystemPrompt: factory,
    });
    buildSystemPrompt(undefined, [ts], makeTsCtx(), undefined, cache);
    buildSystemPrompt(undefined, [ts], makeTsCtx(), undefined, cache);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('passes userMessage to system prompt context', () => {
    const spy = vi.fn(() => 'section');
    const ts = makeToolSet({ sectionId: 'test' as SectionId, onGetSystemPrompt: spy });
    buildSystemPrompt('Base', [ts], makeTsCtx(), 'user query');
    expect(spy).toHaveBeenCalled();
    const promptCtx = (spy.mock.calls[0] as unknown as [unknown, SystemPromptContext])[1];
    expect(promptCtx.userMessage).toBe('user query');
    expect(promptCtx.baseSystemPrompt).toBe('Base');
  });

  // ── Prompt suppression via suppressToolSetPrompt ──────────────────────────

  it('provides suppressToolSetPrompt in the prompt context', () => {
    const spy = vi.fn(() => 'section');
    const ts = makeBrandedToolSet({ onGetSystemPrompt: spy });
    buildSystemPrompt('Base', [ts], makeTsCtx(), undefined, undefined, TEST_BRAND);
    const promptCtx = (spy.mock.calls[0] as unknown as [unknown, SystemPromptContext])[1];
    expect(typeof promptCtx.suppressToolSetPrompt).toBe('function');
  });

  it('gives non-branded ToolSets a no-op suppressToolSetPrompt', () => {
    const spy = vi.fn(() => 'section');
    const ts = makeToolSet({ onGetSystemPrompt: spy }); // no brand
    buildSystemPrompt('Base', [ts], makeTsCtx(), undefined, undefined, TEST_BRAND);
    const promptCtx = (spy.mock.calls[0] as unknown as [unknown, SystemPromptContext])[1];
    expect(typeof promptCtx.suppressToolSetPrompt).toBe('function');
    // Calling it should not throw and should not actually suppress anything
    expect(() => promptCtx.suppressToolSetPrompt('whatever')).not.toThrow();
  });

  it('non-branded ToolSets cannot suppress other ToolSets', () => {
    const targetTs = makeToolSet({
      name: 'Target',
      onGetSystemPrompt: () => 'TARGET_FRAGMENT',
    });
    // Suppressor has NO brand — suppressToolSetPrompt is a no-op
    const suppressorTs = makeToolSet({
      name: 'Suppressor',
      onGetSystemPrompt: (_ctx, promptCtx) => {
        promptCtx.suppressToolSetPrompt('Target');
        return 'SUPPRESSOR_FRAGMENT';
      },
    });
    const result = buildSystemPrompt(undefined, [targetTs, suppressorTs], makeTsCtx(), undefined, undefined, TEST_BRAND);
    // Both fragments should survive — suppression was ignored
    expect(result).toContain('TARGET_FRAGMENT');
    expect(result).toContain('SUPPRESSOR_FRAGMENT');
  });

  it('discards fragments from suppressed ToolSets', () => {
    const targetTs = makeToolSet({
      name: 'Target',
      onGetSystemPrompt: () => 'TARGET_FRAGMENT',
    });
    const suppressorTs = makeBrandedToolSet({
      name: 'Suppressor',
      onGetSystemPrompt: (_ctx, promptCtx) => {
        promptCtx.suppressToolSetPrompt('Target');
        return 'SUPPRESSOR_FRAGMENT';
      },
    });
    const result = buildSystemPrompt(undefined, [targetTs, suppressorTs], makeTsCtx(), undefined, undefined, TEST_BRAND);
    expect(result).toContain('SUPPRESSOR_FRAGMENT');
    expect(result).not.toContain('TARGET_FRAGMENT');
  });

  it('still executes onGetSystemPrompt of suppressed ToolSets', () => {
    const targetSpy = vi.fn(() => 'TARGET_FRAGMENT');
    const targetTs = makeToolSet({
      name: 'Target',
      onGetSystemPrompt: targetSpy,
    });
    const suppressorTs = makeBrandedToolSet({
      name: 'Suppressor',
      onGetSystemPrompt: (_ctx, promptCtx) => {
        promptCtx.suppressToolSetPrompt('Target');
        return undefined;
      },
    });
    buildSystemPrompt(undefined, [targetTs, suppressorTs], makeTsCtx(), undefined, undefined, TEST_BRAND);
    expect(targetSpy).toHaveBeenCalled();
  });

  it('handles suppression when suppressor runs after the target', () => {
    const targetTs = makeToolSet({
      name: 'Target',
      onGetSystemPrompt: () => 'TARGET_FRAGMENT',
    });
    const suppressorTs = makeBrandedToolSet({
      name: 'Suppressor',
      onGetSystemPrompt: (_ctx, promptCtx) => {
        promptCtx.suppressToolSetPrompt('Target');
        return 'SUPPRESSOR_FRAGMENT';
      },
    });
    // Target is first, suppressor is second — suppressor runs after target
    const result = buildSystemPrompt(undefined, [targetTs, suppressorTs], makeTsCtx(), undefined, undefined, TEST_BRAND);
    expect(result).not.toContain('TARGET_FRAGMENT');
    expect(result).toContain('SUPPRESSOR_FRAGMENT');
  });

  it('handles suppression when suppressor runs before the target', () => {
    const targetTs = makeToolSet({
      name: 'Target',
      onGetSystemPrompt: () => 'TARGET_FRAGMENT',
    });
    const suppressorTs = makeBrandedToolSet({
      name: 'Suppressor',
      onGetSystemPrompt: (_ctx, promptCtx) => {
        promptCtx.suppressToolSetPrompt('Target');
        return 'SUPPRESSOR_FRAGMENT';
      },
    });
    // Suppressor is first, target is second — suppressor runs before target
    const result = buildSystemPrompt(undefined, [suppressorTs, targetTs], makeTsCtx(), undefined, undefined, TEST_BRAND);
    expect(result).not.toContain('TARGET_FRAGMENT');
    expect(result).toContain('SUPPRESSOR_FRAGMENT');
  });

  it('does not suppress when suppressToolSetPrompt is not called', () => {
    const ts1 = makeToolSet({
      name: 'A',
      onGetSystemPrompt: () => 'FRAGMENT_A',
    });
    const ts2 = makeToolSet({
      name: 'B',
      onGetSystemPrompt: () => 'FRAGMENT_B',
    });
    const result = buildSystemPrompt(undefined, [ts1, ts2], makeTsCtx(), undefined, undefined, TEST_BRAND);
    expect(result).toContain('FRAGMENT_A');
    expect(result).toContain('FRAGMENT_B');
  });

  it('can suppress multiple ToolSets', () => {
    const ts1 = makeToolSet({ name: 'A', onGetSystemPrompt: () => 'FRAGMENT_A' });
    const ts2 = makeToolSet({ name: 'B', onGetSystemPrompt: () => 'FRAGMENT_B' });
    const ts3 = makeToolSet({ name: 'C', onGetSystemPrompt: () => 'FRAGMENT_C' });
    const suppressor = makeBrandedToolSet({
      name: 'Supp',
      onGetSystemPrompt: (_ctx, promptCtx) => {
        promptCtx.suppressToolSetPrompt('A');
        promptCtx.suppressToolSetPrompt('B');
        return 'SUPP';
      },
    });
    const result = buildSystemPrompt(undefined, [ts1, ts2, ts3, suppressor], makeTsCtx(), undefined, undefined, TEST_BRAND);
    expect(result).not.toContain('FRAGMENT_A');
    expect(result).not.toContain('FRAGMENT_B');
    expect(result).toContain('FRAGMENT_C');
    expect(result).toContain('SUPP');
  });
});

describe('applyToolFilters', () => {
  it('returns all tools when no ToolSet filters', () => {
    const tools: Tool[] = [
      { name: 'a', description: '', parameters: {} as any, execute: async () => {} },
      { name: 'b', description: '', parameters: {} as any, execute: async () => {} },
    ];
    const result = applyToolFilters(tools, [], makeTsCtx());
    expect(result).toHaveLength(2);
  });

  it('applies onFilterTools from each ToolSet in order', () => {
    const tools: Tool[] = [
      { name: 'keep', description: '', parameters: {} as any, execute: async () => {} },
      { name: 'drop', description: '', parameters: {} as any, execute: async () => {} },
    ];
    const filterTs = makeToolSet({
      onFilterTools: (_ctx: ToolSetContext, list: readonly Tool[]) =>
        list.filter((t) => t.name === 'keep'),
    });
    const result = applyToolFilters(tools, [filterTs], makeTsCtx());
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('keep');
  });

  it('chains multiple filters', () => {
    const tools: Tool[] = [
      { name: 'a', description: '', parameters: {} as any, execute: async () => {} },
      { name: 'b', description: '', parameters: {} as any, execute: async () => {} },
      { name: 'c', description: '', parameters: {} as any, execute: async () => {} },
    ];
    const filter1 = makeToolSet({
      onFilterTools: (_ctx: ToolSetContext, list: readonly Tool[]) =>
        list.filter((t) => t.name !== 'a'),
    });
    const filter2 = makeToolSet({
      onFilterTools: (_ctx: ToolSetContext, list: readonly Tool[]) =>
        list.filter((t) => t.name !== 'b'),
    });
    const result = applyToolFilters(tools, [filter1, filter2], makeTsCtx());
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('c');
  });
});

describe('composeToolSetAfterTurn', () => {
  it('returns unchanged history when no ToolSet has onAfterTurn', async () => {
    const history: AgentMessage[] = [{ role: 'user', content: 'hi' }];
    const result = await composeToolSetAfterTurn(history, [], makeTsCtx(), undefined, new AbortController().signal, vi.fn());
    expect(result.history).toEqual(history);
    expect(result.changed).toBe(false);
    expect(result.notices).toEqual([]);
  });

  it('chains compaction results from ToolSets', async () => {
    const step1 = vi.fn().mockResolvedValue({
      history: [{ role: 'user', content: 'step1' }],
      notices: [{ content: 'compacted' }],
      // Note: CompactionNotice requires `content`; `severity`/`message` do not exist on the type.
    });
    const ts = makeToolSet({ onAfterTurn: step1 });
    const result = await composeToolSetAfterTurn(
      [{ role: 'user', content: 'original' }],
      [ts],
      makeTsCtx(),
      { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      new AbortController().signal,
      vi.fn(),
    );
    expect(result.history[0].content).toBe('step1');
    expect(result.changed).toBe(true);
    expect(result.notices).toHaveLength(1);
  });

  it('passes usage and handler to toolSet.onAfterTurn', async () => {
    const spy = vi.fn();
    const ts = makeToolSet({ onAfterTurn: spy });
    const handler = vi.fn();
    const usage = { promptTokens: 5, completionTokens: 3, totalTokens: 8 };
    await composeToolSetAfterTurn(
      [{ role: 'user', content: 'test' }],
      [ts],
      makeTsCtx(),
      usage,
      new AbortController().signal,
      handler,
    );
    expect(spy).toHaveBeenCalled();
    const [, , usageArg, , handlerArg] = spy.mock.calls[0];
    expect(usageArg).toEqual(usage);
    expect(handlerArg).toBe(handler);
  });
});
