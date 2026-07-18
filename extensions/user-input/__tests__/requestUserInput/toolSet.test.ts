// @ts-nocheck
/**
 * extensions/user-input/__tests__/requestUserInput/toolSet.test.ts
 *
 * Full coverage for createUserInputToolSet lifecycle hooks.
 * Tests that:
 *   - onPatchToolContext injects requestUserInput / cancelUserInput / sendMessage
 *   - requestUserInput adds entries to store with correct bind metadata
 *   - AbortSignal cancels pending prompts
 *   - Adapter mode bypasses store
 *   - onGetSymbolState exposes pendingInputs and slots
 *   - onBuildSnapshot serializes pending inputs
 *   - onInit restores ghost entries
 *   - onReady wires ghost → injectToolResult
 *   - onRemove / onReset clean up state
 *   - onGetSystemPrompt returns detailed usage rules
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createUserInputToolSet, USER_INPUT_SYMBOL } from '../../agent/requestUserInput/toolSet';

import type { ToolSetContext, SessionEntryData, SessionReadyHelpers } from '@agent-type';
import type { InlinePromptEntry } from '../../agent/requestUserInput/types';

// ── Typed helpers ────────────────────────────────────────────────────────────

const MINIMAL_CTX: ToolSetContext = {
  sessionId: 'sess-1',
  agentName: 'main',
  conversationId: 'main',
};

const SUB_AGENT_CTX: ToolSetContext = {
  sessionId: 'sess-1',
  agentName: 'researcher',
  conversationId: 'conv-abc',
};

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeEntryData(pendingUserInputs?: readonly InlinePromptEntry[]): SessionEntryData {
  return {
    id: 'sess-1',
    title: 'Test',
    pendingUserInputs,
  } as unknown as SessionEntryData;
}

function makeHelpers(overrides: Partial<SessionReadyHelpers> = {}): SessionReadyHelpers {
  return {
    sendMessage: overrides.sendMessage ?? vi.fn(),
    injectToolResult: overrides.injectToolResult ?? vi.fn(),
  };
}

// ── ToolSet basics ───────────────────────────────────────────────────────────

describe('createUserInputToolSet — basics', () => {
  it('has name "user-input" and symbol', () => {
    const ts = createUserInputToolSet();
    expect(ts.name).toBe('user-input');
    expect(ts.symbol).toBe(USER_INPUT_SYMBOL);
  });

  it('registers ask_user tool', () => {
    const ts = createUserInputToolSet();
    const tools = typeof ts.tools === 'function' ? ts.tools() : ts.tools;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('ask_user');
  });

  it('declares ask_user as core tool', () => {
    const ts = createUserInputToolSet();
    expect(ts.coreTools).toContain('ask_user');
  });

  it('onGetSystemPrompt returns detailed usage rules', () => {
    const ts = createUserInputToolSet();
    const prompt = ts.onGetSystemPrompt!();
    expect(prompt).toContain('ask_user');
    expect(prompt).toContain('confirm');
    expect(prompt).toContain('select');
    expect(prompt).toContain('multiSelect');
    expect(prompt).toContain('number');
    expect(prompt).toContain('suspended');
  });
});

// ── onPatchToolContext ───────────────────────────────────────────────────────

describe('createUserInputToolSet — onPatchToolContext', () => {
  it('injects requestUserInput, cancelUserInput, and sendMessage', () => {
    const ts = createUserInputToolSet();
    // Simulate onReady being called first to cache sendMessage
    ts.onReady!(MINIMAL_CTX, makeHelpers({ sendMessage: vi.fn() }));

    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    expect(patch!.requestUserInput).toBeDefined();
    expect(patch!.cancelUserInput).toBeDefined();
    expect(patch!.sendMessage).toBeDefined();
  });

  it('sendMessage is undefined before onReady', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    expect(patch!.sendMessage).toBeUndefined();
  });

  it('requestUserInput returns the resolved value', async () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    // Start the request and get a reference to the promise
    const promise = patch!.requestUserInput!({ type: 'confirm', message: 'Proceed?' } as any);
    // Resolve it via the store's responder
    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    state.respondUserInput(state.pendingUserInputs[0].id, 'yes');
    const result = await promise;
    expect(result).toBe('yes');
  });

  it('requestUserInput stores entry with toolCallId and toolName', async () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    // Start the request but don't await — check state
    const promise = patch!.requestUserInput!({ type: 'text', message: 'Enter:' });
    const symbolState = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(symbolState.pendingUserInputs).toHaveLength(1);
    expect(symbolState.pendingUserInputs[0].toolCallId).toBeDefined();
    expect(symbolState.pendingUserInputs[0].toolName).toBe('ask_user');
    // Resolve via responder
    symbolState.respondUserInput(symbolState.pendingUserInputs[0].id, 'answer');
    await expect(promise).resolves.toBe('answer');
  });

  it('abort signal removes the pending entry', async () => {
    const ts = createUserInputToolSet();
    const ac = new AbortController();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, ac.signal);
    const promise = patch!.requestUserInput!({ type: 'confirm', message: 'Go?' });

    // Should be pending
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);
    ac.abort();
    await expect(promise).resolves.toBeNull();
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('cancelUserInput removes the entry and resolves to null', async () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    const promise = patch!.requestUserInput!({ type: 'confirm', message: 'Go?' }, 'my-id');
    patch!.cancelUserInput!('my-id');
    await expect(promise).resolves.toBeNull();
  });

  it('adapter mode calls adapter.prompt instead of storing', async () => {
    const adapterPrompt = vi.fn().mockResolvedValue('adapter-answer');
    const ts = createUserInputToolSet({ adapter: { prompt: adapterPrompt } });
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    const result = await patch!.requestUserInput!({ type: 'text', message: 'Q' });
    expect(adapterPrompt).toHaveBeenCalledOnce();
    expect(result).toBe('adapter-answer');
    // Should NOT be stored in the UI-visible store
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('adapter reject resolves to null', async () => {
    const adapterPrompt = vi.fn().mockRejectedValue(new Error('fail'));
    const ts = createUserInputToolSet({ adapter: { prompt: adapterPrompt } });
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    const result = await patch!.requestUserInput!({ type: 'confirm', message: 'Q' });
    expect(result).toBeNull();
  });
});

// ── onInterceptMessage ───────────────────────────────────────────────────────

describe('createUserInputToolSet — onInterceptMessage', () => {
  it('cancels all pending prompts and does not intercept the message', () => {
    const ts = createUserInputToolSet();
    // Create a pending prompt
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'text', message: 'Enter:' });

    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);

    ts.onInterceptMessage!(
      MINIMAL_CTX,
      { content: 'new message from user' },
      false,
    );

    // All prompts should be cancelled
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('does nothing when no prompts are pending', () => {
    const ts = createUserInputToolSet();
    expect(() =>
      ts.onInterceptMessage!(
        MINIMAL_CTX,
        { content: 'hello' },
        false,
      ),
    ).not.toThrow();
  });

  it('does not intercept (returns undefined) so subsequent ToolSets can handle the message', () => {
    const ts = createUserInputToolSet();
    const result = ts.onInterceptMessage!(
      MINIMAL_CTX,
      { content: 'hello' },
      true,
    );
    expect(result).toBeUndefined();
  });

  it('cancels prompts regardless of isLoading flag', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Go?' });

    // isLoading = true (agent busy) — still cancels
    ts.onInterceptMessage!(
      MINIMAL_CTX,
      { content: 'interrupt' },
      true,
    );
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('uses ctxKey isolation — only cancels prompts for the matching session', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'text', message: 'Main?' });

    // Intercept with sub-agent context — should not cancel main session prompts
    ts.onInterceptMessage!(
      SUB_AGENT_CTX,
      { content: 'sub message' },
      false,
    );
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);
  });
});

// ── onGetSymbolState ─────────────────────────────────────────────────────────

describe('createUserInputToolSet — onGetSymbolState', () => {
  it('returns type "requestUserInput"', () => {
    const ts = createUserInputToolSet();
    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(state.type).toBe('requestUserInput');
  });

  it('returns empty pendingUserInputs initially', () => {
    const ts = createUserInputToolSet();
    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(state.pendingUserInputs).toEqual([]);
  });

  it('returns respondUserInput function', () => {
    const ts = createUserInputToolSet();
    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(typeof state.respondUserInput).toBe('function');
  });

  it('returns inlinePrompt, toolCard, and compactToolCard slots', () => {
    const ts = createUserInputToolSet();
    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(state.slots).toHaveLength(3);
    expect(state.slots[0].type).toBe('inlinePrompt');
    expect(state.slots[1].type).toBe('toolCard');
    expect(state.slots[2].type).toBe('compactToolCard');
  });

  it('uses ctxKey for isolation across contexts', () => {
    const ts = createUserInputToolSet();
    // Add entry to main
    const patchMain = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patchMain!.requestUserInput!({ type: 'confirm', message: 'Main?' });
    // Sub-agent should have separate state
    const subState = ts.onGetSymbolState!(SUB_AGENT_CTX);
    expect(subState.pendingUserInputs).toHaveLength(0);
  });
});

// ── onSubscribe ──────────────────────────────────────────────────────────────

describe('createUserInputToolSet — onSubscribe', () => {
  it('notifies on add/remove', () => {
    const ts = createUserInputToolSet();
    const fn = vi.fn();
    ts.onSubscribe!(MINIMAL_CTX, fn);
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'text', message: 'X' });
    expect(fn).toHaveBeenCalled();
  });
});

// ── onBuildSnapshot ──────────────────────────────────────────────────────────

describe('createUserInputToolSet — snapshot/restore', () => {
  it('onBuildSnapshot returns empty object when no pending inputs', () => {
    const ts = createUserInputToolSet();
    expect(ts.onBuildSnapshot!(MINIMAL_CTX)).toEqual({});
  });

  it('onBuildSnapshot serializes pending inputs', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Go?', toolCallId: 'tc-1', toolName: 'ask_user' } as any);

    const snapshot = ts.onBuildSnapshot!(MINIMAL_CTX);
    expect(snapshot.pendingUserInputs).toHaveLength(1);
    expect(snapshot.pendingUserInputs![0].toolCallId).toBe('tc-1');
    expect(snapshot.pendingUserInputs![0].toolName).toBe('ask_user');
  });

  it('onInit restores ghost entries from snapshot', () => {
    const ts = createUserInputToolSet();
    const saved: InlinePromptEntry[] = [
      { id: 'restore-1', kind: 'confirm', message: 'Go?', toolCallId: 'tc-old', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
      { id: 'restore-2', kind: 'text', message: 'Say:', toolCallId: 'tc-old2', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInit!(MINIMAL_CTX, makeEntryData(saved));

    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(state.pendingUserInputs).toHaveLength(2);
    expect(state.pendingUserInputs.map((e) => e.id)).toEqual(['restore-1', 'restore-2']);
  });

  it('onInit does nothing with empty saved data', () => {
    const ts = createUserInputToolSet();
    ts.onInit!(MINIMAL_CTX, makeEntryData(undefined));
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('onReady wires ghost → injectToolResult', () => {
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const helpers = makeHelpers({ injectToolResult });

    const saved: InlinePromptEntry[] = [
      { id: 'ghost-g', kind: 'confirm', message: 'Go?', toolCallId: 'tc-1', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInit!(MINIMAL_CTX, makeEntryData(saved));
    ts.onReady!(MINIMAL_CTX, helpers);

    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    state.respondUserInput('ghost-g', 'yes');

    expect(injectToolResult).toHaveBeenCalledWith('tc-1', 'ask_user', 'yes');
  });

  it('onReady ghost cancelled → no injectToolResult', () => {
    const ts = createUserInputToolSet();
    const helpers = makeHelpers();

    const saved: InlinePromptEntry[] = [
      { id: 'cancel-g', kind: 'confirm', message: 'Go?', toolCallId: 'tc-cancel', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInit!(MINIMAL_CTX, makeEntryData(saved));
    ts.onReady!(MINIMAL_CTX, helpers);

    ts.onGetSymbolState!(MINIMAL_CTX).respondUserInput('cancel-g', null);

    expect(helpers.injectToolResult).not.toHaveBeenCalled();
    expect(helpers.sendMessage).not.toHaveBeenCalled();
  });

  it('onReady does nothing when no ghosts exist', () => {
    const ts = createUserInputToolSet();
    ts.onReady!(MINIMAL_CTX, makeHelpers());
    // Should not throw
    expect(true).toBe(true);
  });

  it('onReady caches sendMessage for onPatchToolContext', () => {
    const ts = createUserInputToolSet();
    const sm = vi.fn();
    ts.onReady!(MINIMAL_CTX, makeHelpers({ sendMessage: sm }));
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    expect(patch!.sendMessage).toBe(sm);
  });

  it('adapter mode skips init/ready restore', () => {
    const ts = createUserInputToolSet({ adapter: { prompt: vi.fn() } });
    const saved: InlinePromptEntry[] = [
      { id: 'g1', kind: 'text', message: 'X', toolCallId: 'tc', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInit!(MINIMAL_CTX, makeEntryData(saved));
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });
});

// ── Session lifecycle — cleanup ──────────────────────────────────────────────

describe('createUserInputToolSet — session lifecycle cleanup', () => {
  it('onRemove cleans up store and caches', () => {
    const ts = createUserInputToolSet();
    const sm = vi.fn();
    ts.onReady!(MINIMAL_CTX, makeHelpers({ sendMessage: sm }));

    // Add a pending input
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'text', message: 'X' });
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);

    ts.onRemove!(MINIMAL_CTX);
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);

    // onPatchToolContext should return undefined sendMessage after cleanup
    const patch2 = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    expect(patch2!.sendMessage).toBeUndefined();
  });

  it('onReset clears pending inputs', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Go?' });
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);
    ts.onReset!(MINIMAL_CTX);
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });
});

// ── Sub-agent (per-conversation) snapshot/restore ────────────────────────────

describe('createUserInputToolSet — sub-agent snapshot/restore', () => {
  it('onBuildSnapshot uses ctxKey (not sessionId) for sub-agent isolation', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(SUB_AGENT_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Sub Q?', toolCallId: 'sa-tc', toolName: 'ask_user' } as any);

    // Sub-agent context should produce a snapshot with pendingUserInputs
    const snapshot = ts.onBuildSnapshot!(SUB_AGENT_CTX);
    expect(snapshot.pendingUserInputs).toHaveLength(1);
    expect(snapshot.pendingUserInputs![0].toolCallId).toBe('sa-tc');

    // Main-agent context should be empty (separate key)
    expect(ts.onBuildSnapshot!(MINIMAL_CTX)).toEqual({});
  });

  it('main agent and sub-agent have independent pending inputs', () => {
    const ts = createUserInputToolSet();
    const mainPatch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    const subPatch  = ts.onPatchToolContext!(SUB_AGENT_CTX, new AbortController().signal);
    void mainPatch!.requestUserInput!({ type: 'text', message: 'Main Q' });
    void subPatch!.requestUserInput!({ type: 'text', message: 'Sub Q' });

    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(1);
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs[0].message).toBe('Main Q');
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs[0].message).toBe('Sub Q');
  });

  it('sub-agent onInit restores ghost entries from snapshot', () => {
    const ts = createUserInputToolSet();
    const saved: InlinePromptEntry[] = [
      { id: 'sub-g1', kind: 'confirm', message: 'Go?', toolCallId: 'tc-s1', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    ts.onInit!(SUB_AGENT_CTX, makeEntryData(saved));

    const state = ts.onGetSymbolState!(SUB_AGENT_CTX);
    expect(state.pendingUserInputs).toHaveLength(1);
    expect(state.pendingUserInputs[0].id).toBe('sub-g1');

    // Main agent should not see sub-agent's entries
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('sub-agent onReady wires ghost → injectToolResult', () => {
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const helpers = makeHelpers({ injectToolResult });

    const saved: InlinePromptEntry[] = [
      { id: 'sub-g', kind: 'confirm', message: 'Proceed?', toolCallId: 'sa-tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    ts.onInit!(SUB_AGENT_CTX, makeEntryData(saved));
    ts.onReady!(SUB_AGENT_CTX, helpers);

    const state = ts.onGetSymbolState!(SUB_AGENT_CTX);
    state.respondUserInput('sub-g', 'yes');

    expect(injectToolResult).toHaveBeenCalledWith('sa-tc', 'ask_user', 'yes');
  });

  it('sub-agent ghost cancelled → no injectToolResult', () => {
    const ts = createUserInputToolSet();
    const helpers = makeHelpers();

    const saved: InlinePromptEntry[] = [
      { id: 'sub-cancel-g', kind: 'confirm', message: 'Go?', toolCallId: 'sa-tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    ts.onInit!(SUB_AGENT_CTX, makeEntryData(saved));
    ts.onReady!(SUB_AGENT_CTX, helpers);

    ts.onGetSymbolState!(SUB_AGENT_CTX).respondUserInput('sub-cancel-g', null);

    expect(helpers.injectToolResult).not.toHaveBeenCalled();
    expect(helpers.sendMessage).not.toHaveBeenCalled();
  });

  it('sub-agent onInterceptMessage cancels pending prompts', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(SUB_AGENT_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Cancel me?' });

    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(1);

    ts.onInterceptMessage!(SUB_AGENT_CTX, { content: 'new message' }, false);
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('sub-agent onRemove cleans up independent state', () => {
    const ts = createUserInputToolSet();
    ts.onReady!(SUB_AGENT_CTX, makeHelpers({ sendMessage: vi.fn() }));
    const patch = ts.onPatchToolContext!(SUB_AGENT_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'text', message: 'Sub Q' });

    // Sub-agent has pending input, main agent does not
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(1);

    ts.onRemove!(SUB_AGENT_CTX);
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('sub-agent onReset clears only sub-agent pending inputs', () => {
    const ts = createUserInputToolSet();
    const mainPatch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    const subPatch  = ts.onPatchToolContext!(SUB_AGENT_CTX, new AbortController().signal);
    void mainPatch!.requestUserInput!({ type: 'text', message: 'Main Q' });
    void subPatch!.requestUserInput!({ type: 'text', message: 'Sub Q' });

    ts.onReset!(SUB_AGENT_CTX);

    // Sub-agent should be cleared
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(0);
    // Main agent should still have its pending input
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);
  });

  // ── Entry-level snapshot isolation (Bug 2 fix) ──────────────────────────
  //
  // The registry's getSnapshot() uses '__entry__' as the conversationId for
  // entry-level ToolSet state to prevent duplicating per-conversation data.
  // Verify that an entry-level context does NOT contain conversation-scoped
  // pendingUserInputs.

  it('entry-level context (__entry__) does not contain per-conversation pendingUserInputs', () => {
    const ts = createUserInputToolSet();
    const entryCtx: ToolSetContext = { sessionId: 'sess-1', agentName: 'asker', conversationId: '__entry__' };
    const convCtx: ToolSetContext = { sessionId: 'sess-1', agentName: 'asker', conversationId: 'conv-abc' };

    // Add pending input to the conversation context
    const patch = ts.onPatchToolContext!(convCtx, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Confirm?' });

    // Conversation sees the pending input
    expect(ts.onBuildSnapshot!(convCtx).pendingUserInputs).toHaveLength(1);

    // Entry-level (__entry__) should NOT see it
    expect(ts.onBuildSnapshot!(entryCtx)).toEqual({});
  });

  it('restore: onInit data before onReady correctly wires injectToolResult', () => {
    // This simulates the corrected loadSnapshot order:
    //   1. initScope(convCtx, {pendingUserInputs}) — onInit with data
    //   2. readyScope(convCtx, {injectToolResult}) — onReady
    //
    // Previously onReady fired BEFORE onInit with data, causing ghosts
    // to never be wired to injectToolResult (Bug 3).
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const helpers = makeHelpers({ injectToolResult });

    const saved: InlinePromptEntry[] = [
      { id: 'restored-g', kind: 'confirm', message: 'Approved?', toolCallId: 'rtc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'asker' },
    ];

    // Step 1: onInit with data (restored from snapshot)
    ts.onInit!(SUB_AGENT_CTX, makeEntryData(saved));
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(1);

    // Step 2: onReady with helpers (wires injectToolResult)
    ts.onReady!(SUB_AGENT_CTX, helpers);

    // Step 3: User answers
    ts.onGetSymbolState!(SUB_AGENT_CTX).respondUserInput('restored-g', 'yes');

    // injectToolResult must have been called — ghost was correctly wired
    expect(injectToolResult).toHaveBeenCalledWith('rtc', 'ask_user', 'yes');
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe('createUserInputToolSet — restore edge cases', () => {
  it('multiple ghosts all resolve via injectToolResult', () => {
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const helpers = makeHelpers({ injectToolResult });

    const saved: InlinePromptEntry[] = [
      { id: 'g-1', kind: 'confirm', message: 'Go?', toolCallId: 'tc-1', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
      { id: 'g-2', kind: 'text', message: 'Name?', toolCallId: 'tc-2', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInit!(MINIMAL_CTX, makeEntryData(saved));
    ts.onReady!(MINIMAL_CTX, helpers);

    ts.onGetSymbolState!(MINIMAL_CTX).respondUserInput('g-1', 'yes');
    ts.onGetSymbolState!(MINIMAL_CTX).respondUserInput('g-2', 'test');

    expect(injectToolResult).toHaveBeenCalledTimes(2);
    expect(injectToolResult).toHaveBeenCalledWith('tc-1', 'ask_user', 'yes');
    expect(injectToolResult).toHaveBeenCalledWith('tc-2', 'ask_user', 'test');
  });

  it('onInterceptMessage after restore cancels pending ghost entries', () => {
    const ts = createUserInputToolSet();
    const helpers = makeHelpers();

    const saved: InlinePromptEntry[] = [
      { id: 'g1', kind: 'confirm', message: 'Go?', toolCallId: 'tc-1', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInit!(MINIMAL_CTX, makeEntryData(saved));
    ts.onReady!(MINIMAL_CTX, helpers);

    // User sends a message instead of answering
    ts.onInterceptMessage!(MINIMAL_CTX, { content: 'new msg' }, false);

    // Ghost should be cancelled
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
    // No injectToolResult should have been called
    expect(helpers.injectToolResult).not.toHaveBeenCalled();
    expect(helpers.sendMessage).not.toHaveBeenCalled();
  });

  it('restore with empty toolCallId/toolName uses fallback defaults', () => {
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const helpers = makeHelpers({ injectToolResult });

    const saved: InlinePromptEntry[] = [
      { id: 'no-tc', kind: 'confirm', message: 'Go?', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInit!(MINIMAL_CTX, makeEntryData(saved));
    ts.onReady!(MINIMAL_CTX, helpers);

    ts.onGetSymbolState!(MINIMAL_CTX).respondUserInput('no-tc', 'yes');

    // Falls back to entry.id for toolCallId and 'ask_user' for toolName
    expect(injectToolResult).toHaveBeenCalledWith('no-tc', 'ask_user', 'yes');
  });

  it('sub-agent with multiple ghosts resolves correctly', () => {
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const helpers = makeHelpers({ injectToolResult });

    const saved: InlinePromptEntry[] = [
      { id: 's-g1', kind: 'confirm', message: 'Go?', toolCallId: 'stc-1', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
      { id: 's-g2', kind: 'text', message: 'Enter:', toolCallId: 'stc-2', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    ts.onInit!(SUB_AGENT_CTX, makeEntryData(saved));
    ts.onReady!(SUB_AGENT_CTX, helpers);

    ts.onGetSymbolState!(SUB_AGENT_CTX).respondUserInput('s-g1', 'yes');
    expect(injectToolResult).toHaveBeenCalledWith('stc-1', 'ask_user', 'yes');

    ts.onGetSymbolState!(SUB_AGENT_CTX).respondUserInput('s-g2', 'free text');
    expect(injectToolResult).toHaveBeenCalledWith('stc-2', 'ask_user', 'free text');
  });
});
