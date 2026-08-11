// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSubAgentToolset } from '../../tools/subagent/subAgentToolset';
import { createSubAgentRegistry } from '../../tools/subagent/registry';
import { createUserInputToolSet as _createUserInputToolSet, USER_INPUT_SYMBOL } from '../../../internal-apps/user-input/agent/requestUserInput/toolSet';
// Wrapper: createUserInputToolSet now returns { toolSet, slotDeclarations }, unwrap for backwards compat
const createUserInputToolSet = (...args: any[]) => _createUserInputToolSet(...args).toolSet;
import { createPendingInputToolSet } from '../../../internal-apps/user-input/agent/pendingInput/toolSet';
import type { ToolSet, ToolSetContext, AgentQueryFns, SessionEntryData, SessionReadyHelpers } from '@agent-type';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const stubHandler = vi.fn(async () => ({ text: 'Sub-agent response.', toolCalls: [] }));

const MAIN_CTX: ToolSetContext = { sessionId: 'sess-1', agentName: 'main', conversationId: 'main' };
const SUB_CTX: ToolSetContext = { sessionId: 'sess-1', agentName: 'researcher', conversationId: 'conv-abc' };

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

// ── ToolSet lifecycle helpers ─────────────────────────────────────────────────

/**
 * Simulate the full restore lifecycle for a sub-agent conversation:
 *   1. onInit (restores ghost entries)
 *   2. onReady (wires resolve callbacks)
 *
 * Returns the helpers so the test can assert on them.
 */
function simulateSubAgentRestore(
  userTs: ToolSet,
  subCtx: ToolSetContext,
  saved: InlinePromptEntry[],
): SessionReadyHelpers {
  const helpers = makeHelpers();
  userTs.onInit!(subCtx, makeEntryData(saved));
  userTs.onReady!(subCtx, helpers);
  return helpers;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sub-agent injectToolResult via user-input ToolSet', () => {
  let userTs: ToolSet;

  beforeEach(() => {
    userTs = createUserInputToolSet();
  });

  // ── onInit isolation ─────────────────────────────────────────────

  it('sub-agent restore does not leak into main agent', () => {
    const saved: InlinePromptEntry[] = [
      { id: 'g1', kind: 'confirm', message: 'Bound?', toolCallId: 'tc-1', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    userTs.onInit!(SUB_CTX, makeEntryData(saved));

    // Sub-agent sees the ghost
    expect(userTs.onGetSymbolState!(SUB_CTX).pendingUserInputs).toHaveLength(1);
    // Main agent does NOT
    expect(userTs.onGetSymbolState!(MAIN_CTX).pendingUserInputs).toHaveLength(0);
  });

  // ── Prompt restoration — injectToolResult ──────────────────────────────────

  it('sub-agent ghost — injectToolResult called with correct args', () => {
    const helpers = simulateSubAgentRestore(userTs, SUB_CTX, [
      { id: 'sa-bound', kind: 'confirm', message: 'Go?', toolCallId: 'sa-tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ]);

    userTs.onGetSymbolState!(SUB_CTX).respondUserInput('sa-bound', 'confirmed');

    expect(helpers.injectToolResult).toHaveBeenCalledWith('sa-tc', 'ask_user', 'confirmed');
    expect(helpers.sendMessage).not.toHaveBeenCalled();
  });



  // ── Ghost resolve = null (cancellation) ─────────────────────────────────

  it('sub-agent bound ghost cancelled — injectToolResult NOT called', () => {
    const helpers = simulateSubAgentRestore(userTs, SUB_CTX, [
      { id: 'sa-cancel', kind: 'confirm', message: 'Go?', toolCallId: 'sa-tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ]);

    userTs.onGetSymbolState!(SUB_CTX).respondUserInput('sa-cancel', null);

    expect(helpers.injectToolResult).not.toHaveBeenCalled();
    expect(helpers.sendMessage).not.toHaveBeenCalled();
  });



  // ── Multiple concurrent sub-agents ──────────────────────────────────────

  it('multiple sub-agents have independent pending inputs', () => {
    const ctxA: ToolSetContext = { sessionId: 'sess-1', agentName: 'agent-a', conversationId: 'conv-a1' };
    const ctxB: ToolSetContext = { sessionId: 'sess-1', agentName: 'agent-b', conversationId: 'conv-b1' };

    const patchA = userTs.onPatchToolContext!(ctxA, new AbortController().signal);
    const patchB = userTs.onPatchToolContext!(ctxB, new AbortController().signal);
    void patchA!.requestUserInput!({ type: 'text', message: 'Q for A' });
    void patchB!.requestUserInput!({ type: 'text', message: 'Q for B' });

    expect(userTs.onGetSymbolState!(ctxA).pendingUserInputs).toHaveLength(1);
    expect(userTs.onGetSymbolState!(ctxA).pendingUserInputs[0].message).toBe('Q for A');
    expect(userTs.onGetSymbolState!(ctxB).pendingUserInputs).toHaveLength(1);
    expect(userTs.onGetSymbolState!(ctxB).pendingUserInputs[0].message).toBe('Q for B');
  });

  // ── Multiple conversations, same sub-agent ─────────────────────────────

  it('same sub-agent, different conversations have isolated inputs', () => {
    const ctxC1: ToolSetContext = { sessionId: 'sess-1', agentName: 'worker', conversationId: 'conv-1' };
    const ctxC2: ToolSetContext = { sessionId: 'sess-1', agentName: 'worker', conversationId: 'conv-2' };

    const p1 = userTs.onPatchToolContext!(ctxC1, new AbortController().signal);
    const p2 = userTs.onPatchToolContext!(ctxC2, new AbortController().signal);
    void p1!.requestUserInput!({ type: 'confirm', message: 'Conv1?' });
    void p2!.requestUserInput!({ type: 'confirm', message: 'Conv2?' });

    expect(userTs.onGetSymbolState!(ctxC1).pendingUserInputs).toHaveLength(1);
    expect(userTs.onGetSymbolState!(ctxC2).pendingUserInputs).toHaveLength(1);
    expect(userTs.onGetSymbolState!(ctxC1).pendingUserInputs[0].message).toBe('Conv1?');
    expect(userTs.onGetSymbolState!(ctxC2).pendingUserInputs[0].message).toBe('Conv2?');

    // Answer only conv-1
    userTs.onGetSymbolState!(ctxC1).respondUserInput(
      userTs.onGetSymbolState!(ctxC1).pendingUserInputs[0].id,
      'yes',
    );
    expect(userTs.onGetSymbolState!(ctxC1).pendingUserInputs).toHaveLength(0);
    expect(userTs.onGetSymbolState!(ctxC2).pendingUserInputs).toHaveLength(1);
  });

  // ── Snapshot isolation per sub-agent ────────────────────────────────────

  it('onBuildSnapshot isolates per sub-agent conversation', () => {
    const ctxAgent: ToolSetContext = { sessionId: 'sess-1', agentName: 'my-agent', conversationId: 'conv-x' };
    const patch = userTs.onPatchToolContext!(ctxAgent, new AbortController().signal);
    void patch!.requestUserInput!({ type: 'text', message: 'Agent Q' });

    const snap = userTs.onBuildSnapshot!(ctxAgent);
    expect(snap.pendingUserInputs).toHaveLength(1);
    expect(snap.pendingUserInputs![0].message).toBe('Agent Q');

    // Different conversation — empty
    const otherCtx: ToolSetContext = { sessionId: 'sess-1', agentName: 'my-agent', conversationId: 'conv-y' };
    expect(userTs.onBuildSnapshot!(otherCtx)).toEqual({});
  });

  // ── Adapter mode (restore skipped) ──────────────────────────────────────

  it('sub-agent with adapter skips init/ready restore', () => {
    const ts = createUserInputToolSet({ adapter: { prompt: vi.fn() } });
    const saved: InlinePromptEntry[] = [
      { id: 'ad-g', kind: 'text', message: 'X', toolCallId: 'tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    ts.onInit!(SUB_CTX, makeEntryData(saved));
    expect(ts.onGetSymbolState!(SUB_CTX).pendingUserInputs).toHaveLength(0);
  });

  // ── onInterceptMessage per sub-agent ────────────────────────────────────

  it('onInterceptMessage clears only its own sub-agent context', () => {
    const ctxA: ToolSetContext = { sessionId: 'sess-1', agentName: 'agent-a', conversationId: 'conv-a' };
    const ctxB: ToolSetContext = { sessionId: 'sess-1', agentName: 'agent-b', conversationId: 'conv-b' };

    const pa = userTs.onPatchToolContext!(ctxA, new AbortController().signal);
    const pb = userTs.onPatchToolContext!(ctxB, new AbortController().signal);
    void pa!.requestUserInput!({ type: 'text', message: 'A Q' });
    void pb!.requestUserInput!({ type: 'text', message: 'B Q' });

    // Intercept on ctxA only
    userTs.onInterceptMessage!(ctxA, { content: 'new msg' }, false);

    expect(userTs.onGetSymbolState!(ctxA).pendingUserInputs).toHaveLength(0);
    expect(userTs.onGetSymbolState!(ctxB).pendingUserInputs).toHaveLength(1);
  });

  // ── onRemove per conversation ────────────────────────────────────

  it('onRemove removes only the target conversation', () => {
    const ctxC1: ToolSetContext = { sessionId: 'sess-1', agentName: 'worker', conversationId: 'conv-1' };
    const ctxC2: ToolSetContext = { sessionId: 'sess-1', agentName: 'worker', conversationId: 'conv-2' };

    userTs.onReady!(ctxC1, makeHelpers({ sendMessage: vi.fn() }));
    userTs.onReady!(ctxC2, makeHelpers({ sendMessage: vi.fn() }));

    const p1 = userTs.onPatchToolContext!(ctxC1, new AbortController().signal);
    const p2 = userTs.onPatchToolContext!(ctxC2, new AbortController().signal);
    void p1!.requestUserInput!({ type: 'text', message: 'C1 Q' });
    void p2!.requestUserInput!({ type: 'text', message: 'C2 Q' });

    userTs.onRemove!(ctxC1);

    expect(userTs.onGetSymbolState!(ctxC1).pendingUserInputs).toHaveLength(0);
    expect(userTs.onGetSymbolState!(ctxC2).pendingUserInputs).toHaveLength(1);
  });

  // ── RespondUserInput on non-existent entry ──────────────────────────────

  it('respondUserInput for unknown id is a no-op', () => {
    const saved: InlinePromptEntry[] = [
      { id: 'real-id', kind: 'confirm', message: 'Real?', toolCallId: 'tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    userTs.onInit!(SUB_CTX, makeEntryData(saved));

    // Answer with a different id than the saved entry
    userTs.onGetSymbolState!(SUB_CTX).respondUserInput('bogus-id', 'test');

    // The real ghost should still be there
    expect(userTs.onGetSymbolState!(SUB_CTX).pendingUserInputs).toHaveLength(1);
    expect(userTs.onGetSymbolState!(SUB_CTX).pendingUserInputs[0].id).toBe('real-id');
  });
});

// ── injectToolResultIntoConversation — full pipeline integration ────────────────────

describe('injectToolResultIntoConversation — integration', () => {
  let handler: ReturnType<typeof vi.fn>;
  let userTs: ToolSet;

  beforeEach(() => {
    handler = vi.fn(async () => ({ text: 'done', toolCalls: [] }));
    userTs = createUserInputToolSet();
  });

  function capturedHelpersRef(): { current: SessionReadyHelpers | undefined } {
    const ref: { current: SessionReadyHelpers | undefined } = { current: undefined };
    return ref;
  }

  it('injects assistant + tool result into conversation tracker', async () => {
    const helpersRef = capturedHelpersRef();
    const captureTs: ToolSet = {
      name: 'capture', tools: [],
      onReady(_ctx: ToolSetContext, h: SessionReadyHelpers) { helpersRef.current = h; },
    };

    const pendingTs = createPendingInputToolSet();

    const registry = createSubAgentRegistry({
      sessionId: 'sess-1',
      handler,
      toolPool: () => new Map(),
      getToolSets: () => [userTs, captureTs, pendingTs],
    });

    const conv = registry.createSubAgent({
      name: 'test-agent', description: '', toolNames: [], maxTurns: 5, parent: '',
    });
    const convId = conv._state.id;
    const ctx: ToolSetContext = { sessionId: 'sess-1', agentName: 'test-agent', conversationId: convId };

    // Simulate restore: add ghost entries then wire with real helpers
    userTs.onInit!(ctx, makeEntryData([
      { id: 'b1', kind: 'confirm', message: 'Go?', toolCallId: 'tc-1', toolName: 'ask_user', conversationId: convId, agentName: 'test-agent' },
    ]));
    userTs.onReady!(ctx, helpersRef.current!);

    // Answer bound prompt — this triggers injectToolResult
    userTs.onGetSymbolState!(ctx).respondUserInput('b1', 'yes');

    // Wait for async injectToolResult + agent loop — verify BOTH the tool
    // result AND the synthetic assistant message appear in the tracker.
    await vi.waitFor(() => {
      const history = conv._state.tracker.getFullHistory();
      expect(history.some((m) => m.role === 'tool' && m.toolCallId === 'tc-1')).toBe(true);
      expect(history.some((m) => m.role === 'assistant' && m.toolCalls?.[0]?.id === 'tc-1')).toBe(true);
    });
  });

  it('injectToolResult is a no-op when conversation is loading', async () => {
    const helpersRef = capturedHelpersRef();
    const captureTs: ToolSet = {
      name: 'capture', tools: [],
      onReady(_ctx: ToolSetContext, h: SessionReadyHelpers) { helpersRef.current = h; },
    };

    const pendingTs = createPendingInputToolSet();

    const registry = createSubAgentRegistry({
      sessionId: 'sess-1',
      handler,
      toolPool: () => new Map(),
      getToolSets: () => [userTs, captureTs, pendingTs],
    });

    const conv = registry.createSubAgent({
      name: 'test-agent', description: '', toolNames: [], maxTurns: 5, parent: '',
    });
    const convId = conv._state.id;
    const ctx: ToolSetContext = { sessionId: 'sess-1', agentName: 'test-agent', conversationId: convId };

    // Set conversation to loading state
    conv._state.isLoading = true;

    // Restore a ghost
    userTs.onInit!(ctx, makeEntryData([
      { id: 'loading-g', kind: 'confirm', message: 'Go?', toolCallId: 'tc-load', toolName: 'ask_user', conversationId: convId, agentName: 'test-agent' },
    ]));
    userTs.onReady!(ctx, helpersRef.current!);

    // Answer — should trigger injectToolResult which is a no-op since isLoading=true
    userTs.onGetSymbolState!(ctx).respondUserInput('loading-g', 'yes');

    // Give async execution time to (not) run
    await new Promise((r) => setTimeout(r, 50));

    // No tool result should be in the tracker
    const history = conv._state.tracker.getFullHistory();
    expect(history.every((m) => m.role !== 'tool' || m.toolCallId !== 'tc-load')).toBe(true);
  });

  it('bound ghost cancelled — no tracker mutation', async () => {
    const helpersRef = capturedHelpersRef();
    const captureTs: ToolSet = {
      name: 'capture', tools: [],
      onReady(_ctx: ToolSetContext, h: SessionReadyHelpers) { helpersRef.current = h; },
    };

    const pendingTs = createPendingInputToolSet();

    const registry = createSubAgentRegistry({
      sessionId: 'sess-1',
      handler,
      toolPool: () => new Map(),
      getToolSets: () => [userTs, captureTs, pendingTs],
    });

    const conv = registry.createSubAgent({
      name: 'test-agent', description: '', toolNames: [], maxTurns: 5, parent: '',
    });
    const convId = conv._state.id;
    const ctx: ToolSetContext = { sessionId: 'sess-1', agentName: 'test-agent', conversationId: convId };

    const historyBefore = conv._state.tracker.getFullHistory().length;

    userTs.onInit!(ctx, makeEntryData([
      { id: 'cancel-g', kind: 'confirm', message: 'Go?', toolCallId: 'tc-cancel', toolName: 'ask_user', conversationId: convId, agentName: 'test-agent' },
    ]));
    userTs.onReady!(ctx, helpersRef.current!);

    // Cancel the prompt
    userTs.onGetSymbolState!(ctx).respondUserInput('cancel-g', null);

    await new Promise((r) => setTimeout(r, 50));
    expect(conv._state.tracker.getFullHistory()).toHaveLength(historyBefore);
  });

});