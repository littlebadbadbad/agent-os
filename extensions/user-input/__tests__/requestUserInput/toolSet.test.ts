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
 *   - onBuildSnapshot serializes pending inputs with boundToTool metadata
 *   - onInitSession restores ghost entries
 *   - onSessionReady wires bound → injectToolResult, unbound → sendMessage
 *   - onRemoveSession / onResetSession clean up state
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
    expect(prompt).toContain('bind_to_tool');
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
    // Simulate onSessionReady being called first to cache sendMessage
    ts.onSessionReady!(MINIMAL_CTX, makeHelpers({ sendMessage: vi.fn() }));

    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    expect(patch!.requestUserInput).toBeDefined();
    expect(patch!.cancelUserInput).toBeDefined();
    expect(patch!.sendMessage).toBeDefined();
  });

  it('sendMessage is undefined before onSessionReady', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    expect(patch!.sendMessage).toBeUndefined();
  });

  it('requestUserInput returns the resolved value', async () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    // Start the request and get a reference to the promise
    const promise = patch!.requestUserInput!({ type: 'confirm', message: 'Proceed?', boundToTool: true } as any);
    // Resolve it via the store's responder
    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    state.respondUserInput(state.pendingUserInputs[0].id, 'yes');
    const result = await promise;
    expect(result).toBe('yes');
  });

  it('requestUserInput stores entry with boundToTool=true by default', async () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    // Start the request but don't await — check state
    const promise = patch!.requestUserInput!({ type: 'text', message: 'Enter:' });
    const symbolState = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(symbolState.pendingUserInputs).toHaveLength(1);
    expect(symbolState.pendingUserInputs[0].boundToTool).toBe(true);
    expect(symbolState.pendingUserInputs[0].toolCallId).toBeDefined();
    expect(symbolState.pendingUserInputs[0].toolName).toBe('ask_user');
    // Resolve via responder
    symbolState.respondUserInput(symbolState.pendingUserInputs[0].id, 'answer');
    await expect(promise).resolves.toBe('answer');
  });

  it('requestUserInput stores entry with boundToTool=false', async () => {
    const ts = createUserInputToolSet();
    ts.onSessionReady!(MINIMAL_CTX, makeHelpers({ sendMessage: vi.fn() }));
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    const promise = patch!.requestUserInput!({ type: 'text', message: 'Enter:', boundToTool: false } as any);

    const symbolState = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(symbolState.pendingUserInputs).toHaveLength(1);
    expect(symbolState.pendingUserInputs[0].boundToTool).toBe(false);
    symbolState.respondUserInput(symbolState.pendingUserInputs[0].id, 'msg');
    await expect(promise).resolves.toBe('msg');
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

  it('returns inlinePrompt slot', () => {
    const ts = createUserInputToolSet();
    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(state.slots).toHaveLength(1);
    expect(state.slots[0].type).toBe('inlinePrompt');
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

  it('onBuildSnapshot serializes pending inputs with bind metadata', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Bound?', boundToTool: true, toolCallId: 'tc-1', toolName: 'ask_user' } as any);
    void patch!.requestUserInput!({ type: 'text', message: 'Unbound', boundToTool: false } as any);

    const snapshot = ts.onBuildSnapshot!(MINIMAL_CTX);
    expect(snapshot.pendingUserInputs).toHaveLength(2);

    const bound = snapshot.pendingUserInputs!.find((e) => e.id === snapshot.pendingUserInputs![0].id)!;
    // Both should have boundToTool preserved
    const entries = snapshot.pendingUserInputs!;
    expect(entries.filter((e) => e.boundToTool)).toHaveLength(1);
    expect(entries.filter((e) => !e.boundToTool)).toHaveLength(1);
    // The bound entry should have toolCallId
    const boundEntry = entries.find((e) => e.boundToTool)!;
    expect(boundEntry.toolCallId).toBe('tc-1');
    expect(boundEntry.toolName).toBe('ask_user');
  });

  it('onInitSession restores ghost entries from snapshot', () => {
    const ts = createUserInputToolSet();
    const saved: InlinePromptEntry[] = [
      { id: 'restore-bound', kind: 'confirm', message: 'Go?', boundToTool: true, toolCallId: 'tc-old', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
      { id: 'restore-unbound', kind: 'text', message: 'Say:', boundToTool: false, toolCallId: 'tc-old2', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInitSession!(MINIMAL_CTX, makeEntryData(saved));

    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    expect(state.pendingUserInputs).toHaveLength(2);
    expect(state.pendingUserInputs.map((e) => e.id)).toEqual(['restore-bound', 'restore-unbound']);
  });

  it('onInitSession does nothing with empty saved data', () => {
    const ts = createUserInputToolSet();
    ts.onInitSession!(MINIMAL_CTX, makeEntryData(undefined));
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('onSessionReady wires bound ghost → injectToolResult', () => {
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const sendMessage = vi.fn();
    const helpers = makeHelpers({ injectToolResult, sendMessage });

    // Restore a bound entry
    const saved: InlinePromptEntry[] = [
      { id: 'bound-g', kind: 'confirm', message: 'Go?', boundToTool: true, toolCallId: 'tc-1', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInitSession!(MINIMAL_CTX, makeEntryData(saved));
    ts.onSessionReady!(MINIMAL_CTX, helpers);

    // Now respond to the ghost prompt
    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    state.respondUserInput('bound-g', 'yes');

    expect(injectToolResult).toHaveBeenCalledWith('tc-1', 'ask_user', 'yes');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('onSessionReady wires unbound ghost → sendMessage', () => {
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const sendMessage = vi.fn();
    const helpers = makeHelpers({ injectToolResult, sendMessage });

    const saved: InlinePromptEntry[] = [
      { id: 'ub-g', kind: 'text', message: 'Say:', boundToTool: false, toolCallId: 'tc-2', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInitSession!(MINIMAL_CTX, makeEntryData(saved));
    ts.onSessionReady!(MINIMAL_CTX, helpers);

    const state = ts.onGetSymbolState!(MINIMAL_CTX);
    state.respondUserInput('ub-g', 'hello');

    expect(sendMessage).toHaveBeenCalledWith('hello');
    expect(injectToolResult).not.toHaveBeenCalled();
  });

  it('onSessionReady does nothing when no ghosts exist', () => {
    const ts = createUserInputToolSet();
    ts.onSessionReady!(MINIMAL_CTX, makeHelpers());
    // Should not throw
    expect(true).toBe(true);
  });

  it('onSessionReady caches sendMessage for onPatchToolContext', () => {
    const ts = createUserInputToolSet();
    const sm = vi.fn();
    ts.onSessionReady!(MINIMAL_CTX, makeHelpers({ sendMessage: sm }));
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    expect(patch!.sendMessage).toBe(sm);
  });

  it('adapter mode skips init/ready restore', () => {
    const ts = createUserInputToolSet({ adapter: { prompt: vi.fn() } });
    const saved: InlinePromptEntry[] = [
      { id: 'g1', kind: 'text', message: 'X', boundToTool: true, toolCallId: 'tc', toolName: 'ask_user', conversationId: 'main', agentName: 'main' },
    ];
    ts.onInitSession!(MINIMAL_CTX, makeEntryData(saved));
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });
});

// ── Session lifecycle — cleanup ──────────────────────────────────────────────

describe('createUserInputToolSet — session lifecycle cleanup', () => {
  it('onRemoveSession cleans up store and caches', () => {
    const ts = createUserInputToolSet();
    const sm = vi.fn();
    ts.onSessionReady!(MINIMAL_CTX, makeHelpers({ sendMessage: sm }));

    // Add a pending input
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'text', message: 'X' });
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);

    ts.onRemoveSession!(MINIMAL_CTX);
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);

    // onPatchToolContext should return undefined sendMessage after cleanup
    const patch2 = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    expect(patch2!.sendMessage).toBeUndefined();
  });

  it('onResetSession clears pending inputs', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Go?' });
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);
    ts.onResetSession!(MINIMAL_CTX);
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });
});

// ── Sub-agent (per-conversation) snapshot/restore ────────────────────────────

describe('createUserInputToolSet — sub-agent snapshot/restore', () => {
  it('onBuildSnapshot uses ctxKey (not sessionId) for sub-agent isolation', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(SUB_AGENT_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Sub-bound?', boundToTool: true, toolCallId: 'sa-tc', toolName: 'ask_user' } as any);

    // Sub-agent context should produce a snapshot with pendingUserInputs
    const snapshot = ts.onBuildSnapshot!(SUB_AGENT_CTX);
    expect(snapshot.pendingUserInputs).toHaveLength(1);
    expect(snapshot.pendingUserInputs![0].boundToTool).toBe(true);
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

  it('sub-agent onInitSession restores ghost entries from snapshot', () => {
    const ts = createUserInputToolSet();
    const saved: InlinePromptEntry[] = [
      { id: 'sub-g1', kind: 'confirm', message: 'Go?', boundToTool: true, toolCallId: 'tc-s1', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    ts.onInitSession!(SUB_AGENT_CTX, makeEntryData(saved));

    const state = ts.onGetSymbolState!(SUB_AGENT_CTX);
    expect(state.pendingUserInputs).toHaveLength(1);
    expect(state.pendingUserInputs[0].id).toBe('sub-g1');

    // Main agent should not see sub-agent's entries
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('sub-agent onSessionReady wires bound ghost → injectToolResult', () => {
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const sendMessage = vi.fn();
    const helpers = makeHelpers({ injectToolResult, sendMessage });

    const saved: InlinePromptEntry[] = [
      { id: 'sub-bound', kind: 'confirm', message: 'Proceed?', boundToTool: true, toolCallId: 'sa-tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    ts.onInitSession!(SUB_AGENT_CTX, makeEntryData(saved));
    ts.onSessionReady!(SUB_AGENT_CTX, helpers);

    const state = ts.onGetSymbolState!(SUB_AGENT_CTX);
    state.respondUserInput('sub-bound', 'yes');

    expect(injectToolResult).toHaveBeenCalledWith('sa-tc', 'ask_user', 'yes');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sub-agent onSessionReady wires unbound ghost → sendMessage', () => {
    const ts = createUserInputToolSet();
    const injectToolResult = vi.fn();
    const sendMessage = vi.fn();
    const helpers = makeHelpers({ injectToolResult, sendMessage });

    const saved: InlinePromptEntry[] = [
      { id: 'sub-ub', kind: 'text', message: 'What?', boundToTool: false, conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    ts.onInitSession!(SUB_AGENT_CTX, makeEntryData(saved));
    ts.onSessionReady!(SUB_AGENT_CTX, helpers);

    const state = ts.onGetSymbolState!(SUB_AGENT_CTX);
    state.respondUserInput('sub-ub', 'hello from sub');

    expect(sendMessage).toHaveBeenCalledWith('hello from sub');
    expect(injectToolResult).not.toHaveBeenCalled();
  });

  it('sub-agent onInterceptMessage cancels pending prompts', () => {
    const ts = createUserInputToolSet();
    const patch = ts.onPatchToolContext!(SUB_AGENT_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'confirm', message: 'Cancel me?' });

    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(1);

    ts.onInterceptMessage!(SUB_AGENT_CTX, { content: 'new message' }, false);
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('sub-agent onRemoveSession cleans up independent state', () => {
    const ts = createUserInputToolSet();
    ts.onSessionReady!(SUB_AGENT_CTX, makeHelpers({ sendMessage: vi.fn() }));
    const patch = ts.onPatchToolContext!(SUB_AGENT_CTX, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'text', message: 'Sub Q' });

    // Sub-agent has pending input, main agent does not
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(1);

    ts.onRemoveSession!(SUB_AGENT_CTX);
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(0);
  });

  it('sub-agent onResetSession clears only sub-agent pending inputs', () => {
    const ts = createUserInputToolSet();
    const mainPatch = ts.onPatchToolContext!(MINIMAL_CTX, new AbortController().signal);
    const subPatch  = ts.onPatchToolContext!(SUB_AGENT_CTX, new AbortController().signal);
    void mainPatch!.requestUserInput!({ type: 'text', message: 'Main Q' });
    void subPatch!.requestUserInput!({ type: 'text', message: 'Sub Q' });

    ts.onResetSession!(SUB_AGENT_CTX);

    // Sub-agent should be cleared
    expect(ts.onGetSymbolState!(SUB_AGENT_CTX).pendingUserInputs).toHaveLength(0);
    // Main agent should still have its pending input
    expect(ts.onGetSymbolState!(MINIMAL_CTX).pendingUserInputs).toHaveLength(1);
  });
});
