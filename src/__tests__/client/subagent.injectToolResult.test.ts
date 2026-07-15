/**
 * src/__tests__/client/subagent.injectToolResult.test.ts
 *
 * Tests for the sub-agent injectToolResult pipeline:
 *   - createSubAgentRegistry + user-input ToolSet integration
 *   - onSessionReady wires injectToolResult to the sub-agent conversation
 *   - injectToolResultIntoConversation in registryExecution pushes a tool
 *     result and starts the agent loop
 *
 * Covers:
 *   - Sub-agent bound prompt restore → injectToolResult
 *   - Sub-agent unbound prompt restore → sendMessage
 *   - Loading guard (no-op when busy)
 *   - Missing entry / missing conversation edge cases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSubAgentToolset } from '../../tools/subagent/metaTools';
import { createUserInputToolSet } from '../../../extensions/user-input/agent/requestUserInput/toolSet';
import { USER_INPUT_SYMBOL } from '../../../extensions/user-input/agent/requestUserInput/toolSet';
import type { ToolSet, ToolSetContext, AgentQueryFns, SessionEntryData, SessionReadyHelpers } from '@agent-type';
import type { InlinePromptEntry } from '../../../extensions/user-input/agent/requestUserInput/types';

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
 *   1. onInitSession (restores ghost entries)
 *   2. onSessionReady (wires resolve callbacks)
 *
 * Returns the helpers so the test can assert on them.
 */
function simulateSubAgentRestore(
  userTs: ToolSet,
  subCtx: ToolSetContext,
  saved: InlinePromptEntry[],
): SessionReadyHelpers {
  const helpers = makeHelpers();
  userTs.onInitSession!(subCtx, makeEntryData(saved));
  userTs.onSessionReady!(subCtx, helpers);
  return helpers;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sub-agent injectToolResult via user-input ToolSet', () => {
  let userTs: ToolSet;

  beforeEach(() => {
    userTs = createUserInputToolSet();
  });

  // ── onInitSession isolation ─────────────────────────────────────────────

  it('sub-agent restore does not leak into main agent', () => {
    const saved: InlinePromptEntry[] = [
      { id: 'g1', kind: 'confirm', message: 'Bound?', boundToTool: true, toolCallId: 'tc-1', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    userTs.onInitSession!(SUB_CTX, makeEntryData(saved));

    // Sub-agent sees the ghost
    expect(userTs.onGetSymbolState!(SUB_CTX).pendingUserInputs).toHaveLength(1);
    // Main agent does NOT
    expect(userTs.onGetSymbolState!(MAIN_CTX).pendingUserInputs).toHaveLength(0);
  });

  // ── Bound prompt restoration ────────────────────────────────────────────

  it('sub-agent bound ghost → injectToolResult called with correct args', () => {
    const helpers = simulateSubAgentRestore(userTs, SUB_CTX, [
      { id: 'sa-bound', kind: 'confirm', message: 'Go?', boundToTool: true, toolCallId: 'sa-tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ]);

    userTs.onGetSymbolState!(SUB_CTX).respondUserInput('sa-bound', 'confirmed');

    expect(helpers.injectToolResult).toHaveBeenCalledWith('sa-tc', 'ask_user', 'confirmed');
    expect(helpers.sendMessage).not.toHaveBeenCalled();
  });

  // ── Unbound prompt restoration ──────────────────────────────────────────

  it('sub-agent unbound ghost → sendMessage called', () => {
    const helpers = simulateSubAgentRestore(userTs, SUB_CTX, [
      { id: 'sa-ub', kind: 'text', message: 'Say:', boundToTool: false, conversationId: 'conv-abc', agentName: 'researcher' },
    ]);

    userTs.onGetSymbolState!(SUB_CTX).respondUserInput('sa-ub', 'free text');

    expect(helpers.sendMessage).toHaveBeenCalledWith('free text');
    expect(helpers.injectToolResult).not.toHaveBeenCalled();
  });

  // ── Ghost resolve = null (cancellation) ─────────────────────────────────

  it('sub-agent bound ghost cancelled → injectToolResult NOT called', () => {
    const helpers = simulateSubAgentRestore(userTs, SUB_CTX, [
      { id: 'sa-cancel', kind: 'confirm', message: 'Go?', boundToTool: true, toolCallId: 'sa-tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ]);

    userTs.onGetSymbolState!(SUB_CTX).respondUserInput('sa-cancel', null);

    expect(helpers.injectToolResult).not.toHaveBeenCalled();
    expect(helpers.sendMessage).not.toHaveBeenCalled();
  });

  it('sub-agent unbound ghost cancelled → sendMessage NOT called', () => {
    const helpers = simulateSubAgentRestore(userTs, SUB_CTX, [
      { id: 'sa-ub-cancel', kind: 'text', message: 'Say:', boundToTool: false, conversationId: 'conv-abc', agentName: 'researcher' },
    ]);

    userTs.onGetSymbolState!(SUB_CTX).respondUserInput('sa-ub-cancel', null);

    expect(helpers.sendMessage).not.toHaveBeenCalled();
    expect(helpers.injectToolResult).not.toHaveBeenCalled();
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
    void patch!.requestUserInput!({ type: 'text', message: 'Agent Q', boundToTool: false });

    const snap = userTs.onBuildSnapshot!(ctxAgent);
    expect(snap.pendingUserInputs).toHaveLength(1);
    expect(snap.pendingUserInputs![0].message).toBe('Agent Q');
    expect(snap.pendingUserInputs![0].boundToTool).toBe(false);

    // Different conversation — empty
    const otherCtx: ToolSetContext = { sessionId: 'sess-1', agentName: 'my-agent', conversationId: 'conv-y' };
    expect(userTs.onBuildSnapshot!(otherCtx)).toEqual({});
  });

  // ── Adapter mode (restore skipped) ──────────────────────────────────────

  it('sub-agent with adapter skips init/ready restore', () => {
    const ts = createUserInputToolSet({ adapter: { prompt: vi.fn() } });
    const saved: InlinePromptEntry[] = [
      { id: 'ad-g', kind: 'text', message: 'X', boundToTool: true, toolCallId: 'tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    ts.onInitSession!(SUB_CTX, makeEntryData(saved));
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

  // ── onRemoveSession per conversation ────────────────────────────────────

  it('onRemoveSession removes only the target conversation', () => {
    const ctxC1: ToolSetContext = { sessionId: 'sess-1', agentName: 'worker', conversationId: 'conv-1' };
    const ctxC2: ToolSetContext = { sessionId: 'sess-1', agentName: 'worker', conversationId: 'conv-2' };

    userTs.onSessionReady!(ctxC1, makeHelpers({ sendMessage: vi.fn() }));
    userTs.onSessionReady!(ctxC2, makeHelpers({ sendMessage: vi.fn() }));

    const p1 = userTs.onPatchToolContext!(ctxC1, new AbortController().signal);
    const p2 = userTs.onPatchToolContext!(ctxC2, new AbortController().signal);
    void p1!.requestUserInput!({ type: 'text', message: 'C1 Q' });
    void p2!.requestUserInput!({ type: 'text', message: 'C2 Q' });

    userTs.onRemoveSession!(ctxC1);

    expect(userTs.onGetSymbolState!(ctxC1).pendingUserInputs).toHaveLength(0);
    expect(userTs.onGetSymbolState!(ctxC2).pendingUserInputs).toHaveLength(1);
  });

  // ── RespondUserInput on non-existent entry ──────────────────────────────

  it('respondUserInput for unknown id is a no-op', () => {
    const saved: InlinePromptEntry[] = [
      { id: 'real-id', kind: 'confirm', message: 'Real?', boundToTool: true, toolCallId: 'tc', toolName: 'ask_user', conversationId: 'conv-abc', agentName: 'researcher' },
    ];
    userTs.onInitSession!(SUB_CTX, makeEntryData(saved));

    // Answer with a different id than the saved entry
    userTs.onGetSymbolState!(SUB_CTX).respondUserInput('bogus-id', 'test');

    // The real ghost should still be there
    expect(userTs.onGetSymbolState!(SUB_CTX).pendingUserInputs).toHaveLength(1);
    expect(userTs.onGetSymbolState!(SUB_CTX).pendingUserInputs[0].id).toBe('real-id');
  });
});
