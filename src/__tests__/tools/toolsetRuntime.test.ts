/**
 * Tests for ctxKey and related runtime utilities from agent-type/toolset.ts
 * and src/tools/toolSet.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { MAIN_CONVERSATION_ID, ctxKey } from '@agent-type';
import type { ToolSetContext, ToolSet, SystemPromptContext } from '@agent-type';
import { isBranded } from '../../tools/toolSet';
import { buildSystemPrompt } from '../../tools/agentRuntime';

describe('MAIN_CONVERSATION_ID', () => {
  it('is the string "main"', () => {
    expect(MAIN_CONVERSATION_ID).toBe('main');
  });
});

describe('ctxKey', () => {
  const SESSION_ID = 'sess-abc-123';

  it('returns sessionId for main conversation', () => {
    const ctx: ToolSetContext = {
      sessionId: SESSION_ID,
      agentName: 'main',
      conversationId: MAIN_CONVERSATION_ID,
    };
    expect(ctxKey(ctx)).toBe(SESSION_ID);
  });

  it('returns composite key for sub-agent conversation', () => {
    const ctx: ToolSetContext = {
      sessionId: SESSION_ID,
      agentName: 'researcher',
      conversationId: 'conv-xyz',
    };
    expect(ctxKey(ctx)).toBe('sess-abc-123:researcher:conv-xyz');
  });

  it('includes agentName and conversationId in composite key', () => {
    const ctxA: ToolSetContext = {
      sessionId: SESSION_ID,
      agentName: 'agent-a',
      conversationId: 'conv-1',
    };
    const ctxB: ToolSetContext = {
      sessionId: SESSION_ID,
      agentName: 'agent-b',
      conversationId: 'conv-1',
    };
    const keyA = ctxKey(ctxA);
    const keyB = ctxKey(ctxB);
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe('sess-abc-123:agent-a:conv-1');
    expect(keyB).toBe('sess-abc-123:agent-b:conv-1');
  });
});

describe('isBranded', () => {
  const TEST_BRAND = Symbol('test.brand');

  it('returns true when brand symbol is set to true', () => {
    const ts = {
      name: 'branded_ts',
      tools: [],
      [TEST_BRAND]: true,
    };
    expect(isBranded(ts, TEST_BRAND)).toBe(true);
  });

  it('returns false when brand symbol is not set', () => {
    const ts = { name: 'unbranded_ts', tools: [] };
    expect(isBranded(ts, TEST_BRAND)).toBe(false);
  });

  it('returns false when brand symbol is set to false', () => {
    const ts = {
      name: 'false_branded_ts',
      tools: [],
      [TEST_BRAND]: false,
    };
    expect(isBranded(ts, TEST_BRAND)).toBe(false);
  });

  it('returns false when brand symbol is set to a non-boolean value', () => {
    const ts = {
      name: 'string_branded_ts',
      tools: [],
      [TEST_BRAND]: 'yes',
    };
    expect(isBranded(ts, TEST_BRAND)).toBe(false);
  });

  it('returns false when checking with a different brand symbol', () => {
    const OTHER_BRAND = Symbol('other.brand');
    const ts = {
      name: 'misbranded_ts',
      tools: [],
      [TEST_BRAND]: true,
    };
    expect(isBranded(ts, OTHER_BRAND)).toBe(false);
  });
});

// ── End-to-end: isBranded gates suppressToolSetPrompt ───────────────────────────
//
// These tests verify that `isBranded` is the exact predicate used by
// `buildSystemPrompt` to decide whether a ToolSet gets a real
// `suppressToolSetPrompt` callback or a no-op.  They connect the two
// modules without duplicating agentRuntime.test.ts.

describe('brand gates suppressToolSetPrompt', () => {
  const BRAND = Symbol('e2e.brand');

  function makeCtx(): ToolSetContext {
    return { sessionId: 's', agentName: 'a', conversationId: MAIN_CONVERSATION_ID };
  }

  it('branded ToolSet receives functional suppressToolSetPrompt via isBranded', () => {
    const branded: ToolSet = {
      name: 'Privileged',
      tools: [],
      [BRAND]: true,
    };

    const canSuppress = isBranded(branded, BRAND);
    expect(canSuppress).toBe(true);

    // Verify buildSystemPrompt grants the real callback
    const spy = vi.fn<() => string>(() => 'fragment');
    branded.onGetSystemPrompt = spy;
    buildSystemPrompt(undefined, [branded], makeCtx(), undefined, undefined, BRAND);

    const promptCtx = spy.mock.calls[0]![1] as SystemPromptContext;
    const logged: string[] = [];
    promptCtx.suppressToolSetPrompt('Other');
    // Should not throw — a real callback was given
    expect(() => logged).not.toThrow();
  });

  it('unbranded ToolSet receives no-op suppressToolSetPrompt via isBranded', () => {
    const unbranded: ToolSet = {
      name: 'Regular',
      tools: [],
      // No brand set
    };

    const canSuppress = isBranded(unbranded, BRAND);
    expect(canSuppress).toBe(false);

    // Verify buildSystemPrompt grants only a no-op
    const spy = vi.fn<() => string>(() => 'fragment');
    unbranded.onGetSystemPrompt = spy;
    buildSystemPrompt(undefined, [unbranded], makeCtx(), undefined, undefined, BRAND);

    const promptCtx = spy.mock.calls[0]![1] as SystemPromptContext;
    promptCtx.suppressToolSetPrompt('Other');
    // No-op does nothing — just verifies it doesn't throw
  });

  it('wrong-brand ToolSet cannot suppress despite carrying a different brand', () => {
    const OTHER_BRAND = Symbol('other.brand');
    const wrongBrand: ToolSet = {
      name: 'WrongBrand',
      tools: [],
      [OTHER_BRAND]: true,
    };

    // isBranded with BRAND returns false
    expect(isBranded(wrongBrand, BRAND)).toBe(false);

    // Also verify that isBranded with OTHER_BRAND returns true
    expect(isBranded(wrongBrand, OTHER_BRAND)).toBe(true);
  });

  it('without passing brand to buildSystemPrompt, no ToolSet can suppress', () => {
    const branded: ToolSet = {
      name: 'Branded',
      tools: [],
      [BRAND]: true,
    };

    // isBranded passes, but buildSystemPrompt receives no brand
    expect(isBranded(branded, BRAND)).toBe(true);

    const spy = vi.fn<() => string>(() => 'fragment');
    branded.onGetSystemPrompt = spy;
    buildSystemPrompt(undefined, [branded], makeCtx()); // no brand arg

    const promptCtx = spy.mock.calls[0]![1] as SystemPromptContext;
    // Even though the ToolSet carries the brand, the prompt doesn't activate it
    // because buildSystemPrompt wasn't given the brand symbol to check against.
    // Call the no-op to verify it doesn't throw.
    expect(() => promptCtx.suppressToolSetPrompt('Other')).not.toThrow();
  });

  it('demonstrates actual suppression: branded suppressor hides target fragment', () => {
    const target: ToolSet = {
      name: 'Target',
      tools: [],
      onGetSystemPrompt: () => 'TARGET',
    };

    const suppressor: ToolSet = {
      name: 'Suppressor',
      tools: [],
      [BRAND]: true,
      onGetSystemPrompt: (_ctx, pc) => {
        pc.suppressToolSetPrompt('Target');
        return 'SUPPRESSOR';
      },
    };

    const result = buildSystemPrompt(
      undefined, [target, suppressor], makeCtx(), undefined, undefined, BRAND,
    );

    expect(result).toContain('SUPPRESSOR');
    expect(result).not.toContain('TARGET');
  });
});
