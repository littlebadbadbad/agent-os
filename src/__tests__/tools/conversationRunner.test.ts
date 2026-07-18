import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createConversationRunner } from '../../tools/conversationRunner';
import type { ConversationRunnerDeps } from '../../tools/conversationRunner';
import { createMessageList, assistantMsg, toolMsg, type Message } from '../../tools/messageList';
import { createHistoryTracker } from '../../tools/historyTracker';
import type { ToolSetScope } from '../../tools/toolSetScope';
import type { EngineRefs } from '../../tools/conversationEngine';
import type { EngineHooks, EngineRunResult } from '../../tools/conversationEngine';
import type { AgentMessage, ToolSetContext, AgentTurnResponse, AgentRunOutcome, ToolCall } from '@agent-type';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../tools/agentLoop', () => ({ drainAgentStream: vi.fn() }));
vi.mock('../../tools/conversationEngine', () => ({ runEngine: vi.fn() }));
vi.mock('../../tools/agentLoopCore', () => ({ runAgentLoopCore: vi.fn() }));

import { runEngine } from '../../tools/conversationEngine';
import { runAgentLoopCore } from '../../tools/agentLoopCore';
const mockRunEngine = vi.mocked(runEngine);
const mockRunLoop = vi.mocked(runAgentLoopCore);

// ── Shared test values ────────────────────────────────────────────────────────

const SESSION_ID = 'test-session';
const AGENT_NAME = 'main';
const CONVERSATION_ID = 'main';

const tsCtx: ToolSetContext = {
  sessionId: SESSION_ID,
  agentName: AGENT_NAME,
  conversationId: CONVERSATION_ID,
};

function makeScope(overrides?: Partial<ToolSetScope>): ToolSetScope {
  return {
    initScope: vi.fn(),
    readyScope: vi.fn(),
    resetScope: vi.fn(),
    removeScope: vi.fn(),
    subscribeScope: vi.fn(() => vi.fn()),
    beforeRun: vi.fn(),
    afterRun: vi.fn(),
    interceptMessage: vi.fn(() => false),
    beforeInvoke: vi.fn(() => []),
    buildSystemPrompt: vi.fn(() => 'system prompt'),
    filterTools: vi.fn((tools) => tools),
    composeAfterTurn: vi.fn(() => Promise.resolve({ changed: false, history: [] as AgentMessage[], notices: [] as never[] })),
    createPipeline: vi.fn() as any,
    collectState: vi.fn(() => ({})),
    collectSnapshot: vi.fn(() => ({})),
    ...overrides,
  } as any;
}

function makeDeps(overrides?: Partial<ConversationRunnerDeps>): ConversationRunnerDeps {
  return {
    msgList: createMessageList(),
    tracker: createHistoryTracker(),
    refs: { isLoading: false, abortController: null },
    scope: makeScope(),
    tsCtx,
    maxAgentTurns: 10,
    notify: vi.fn(),
    invokeHandler: vi.fn(() => Promise.resolve({ text: 'ok' } as AgentTurnResponse)),
    runToolCall: vi.fn((call: ToolCall) => Promise.resolve({ toolCallId: call.id, name: call.name, result: 'ok' })),
    ...overrides,
  } as ConversationRunnerDeps;
}

// ── Mock setup helpers ─────────────────────────────────────────────────────────

function setupEngine(): void {
  mockRunEngine.mockImplementation(async (
    refs: EngineRefs,
    hooks: EngineHooks,
    run: (signal: AbortSignal) => Promise<EngineRunResult>,
    notify: () => void,
  ): Promise<void> => {
    hooks.onBeforeRun?.();
    refs.isLoading = true;
    notify();
    const controller = new AbortController();
    refs.abortController = controller;
    try {
      await run(controller.signal);
    } finally {
      refs.abortController = null;
      refs.isLoading = false;
      notify();
    }
  });
}

function setupLoop(responseText = 'done', completed = true): void {
  mockRunLoop.mockImplementation(async (config: any) => {
    await config.invokeHandler(config.initialHistory, new AbortController().signal);
    config.hooks?.onStreamEnd?.();
    config.hooks?.onAssistantText?.(responseText, undefined);
    const afterTurnResult = await config.hooks?.onAfterTurn?.(
      config.initialHistory, undefined, new AbortController().signal,
    );
    return {
      output: responseText,
      turns: 1,
      toolCallCount: 0,
      history: afterTurnResult ?? config.initialHistory,
      completed,
    };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConversationRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupEngine();
    setupLoop('Hello!', true);
  });

  // ── sendMessage ──────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('pushes user message to msgList and tracker', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Hello');

      const userMsgs = deps.msgList.messages.filter(m => m.role === 'user');
      expect(userMsgs.length).toBe(1);
      expect(userMsgs[0].content).toBe('Hello');

      const tracked = deps.tracker.getLiveHistory().filter(m => m.role === 'user');
      expect(tracked.pop()?.content).toBe('Hello');
    });

    it('respects onInterceptMessage before pushing', async () => {
      const intercept = vi.fn(() => true);
      const deps = makeDeps({ onInterceptMessage: intercept });
      const runner = createConversationRunner(deps);

      await runner.sendMessage('intercepted');

      expect(intercept).toHaveBeenCalledWith('intercepted', undefined, false);
      expect(deps.msgList.length).toBe(0);
    });

    it('skips empty text without attachments', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);
      await runner.sendMessage('   ');
      expect(deps.msgList.length).toBe(0);
    });

    it('runs the agent loop and produces assistant message', async () => {
      setupLoop('Response text');
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Hi');

      const msgs = deps.msgList.messages;
      expect(msgs.length).toBeGreaterThanOrEqual(2);
      expect(msgs[msgs.length - 1].role).toBe('assistant');
    });

    it('calls notify with isLoading states', async () => {
      const notify = vi.fn();
      const deps = makeDeps({ notify });
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Hi');

      expect(notify).toHaveBeenCalledWith(true);
      expect(notify).toHaveBeenCalledWith(false);
    });

    it('sets isStreaming=false on assistant messages after completion', async () => {
      setupLoop('done');
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Hi');

      const assistants = deps.msgList.messages.filter(m => m.role === 'assistant');
      for (const m of assistants) {
        expect(m.isStreaming).toBe(false);
      }
    });

    it('handles max-turns by pushing a follow-up notice', async () => {
      setupLoop('partial', false);
      const deps = makeDeps({ maxAgentTurns: 5 });
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Test');

      const last = deps.msgList.messages[deps.msgList.messages.length - 1];
      expect(last?.role).toBe('assistant');
      expect(last?.content).toContain('maximum number of agent turns');
    });

    it('survives AbortError with isStreaming=false', async () => {
      mockRunLoop.mockImplementationOnce(async () => { throw new DOMException('Aborted', 'AbortError'); });
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Test');

      const assistants = deps.msgList.messages.filter(m => m.role === 'assistant');
      expect(assistants.length).toBeGreaterThanOrEqual(1);
      expect(assistants[0].isStreaming).toBe(false);
    });

    it('survives unexpected errors gracefully', async () => {
      mockRunLoop.mockImplementationOnce(async () => { throw new Error('Unexpected'); });
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Test');

      const assistants = deps.msgList.messages.filter(m => m.role === 'assistant');
      expect(assistants.length).toBeGreaterThanOrEqual(1);
    });

    it('calls scope.composeAfterTurn through onAfterTurn', async () => {
      const composeAfterTurn = vi.fn(() => Promise.resolve({ changed: false, history: [] as AgentMessage[], notices: [] as never[] }));
      const scope = makeScope({ composeAfterTurn });
      const deps = makeDeps({ scope });
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Hi');

      expect(composeAfterTurn).toHaveBeenCalled();
    });

    it('calls scope.beforeInvoke for queued user messages', async () => {
      const beforeInvoke = vi.fn(() => [] as AgentMessage[]);
      const scope = makeScope({ beforeInvoke });
      const deps = makeDeps({ scope });
      // Override loop mock to call onBeforeInvoke
      mockRunLoop.mockImplementationOnce(async (config: any) => {
        config.hooks?.onBeforeInvoke?.();
        const h = config.hooks!;
        h.onStreamEnd?.();
        h.onAssistantText?.('done', undefined);
        await h.onAfterTurn?.(config.initialHistory, undefined, new AbortController().signal);
        return { output: 'done', turns: 1, toolCallCount: 0, history: config.initialHistory, completed: true };
      });
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Hi');

      expect(beforeInvoke).toHaveBeenCalled();
    });

    it('rejects duplicate send while isLoading', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      deps.refs.isLoading = true;
      await runner.sendMessage('Second');
      expect(deps.msgList.length).toBe(0);
    });

    it('fires streaming hooks: text, thinking, pre-executed, attachment', async () => {
      mockRunLoop.mockImplementationOnce(async (config: any) => {
        const h = config.hooks!;
        h.onTextDelta?.('Hello ', false);
        h.onThinkingDelta?.('thinking...', false);
        h.onPreExecutedResult?.(
          { id: 'tc1', name: 'echo', arguments: {} },
          { toolCallId: 'tc1', name: 'echo', result: 'r1' },
        );
        h.onAttachment?.({ source: 'data' as const, kind: 'image' as const, mimeType: 'image/png', data: 'b64' });
        h.onFirstToolSeen?.();
        h.onStreamEnd?.();
        h.onAssistantText?.('Hello ', undefined);
        await h.onAfterTurn?.(config.initialHistory, undefined, new AbortController().signal);
        return { output: 'Hello ', turns: 1, toolCallCount: 1, history: config.initialHistory, completed: true };
      });
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Stream test');

      const tools = deps.msgList.messages.filter(m => m.role === 'tool');
      expect(tools.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── editAndSendMessage ────────────────────────────────────────────────────

  describe('editAndSendMessage', () => {
    it('truncates at the edited user message and re-runs', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('First');
      const firstUser = deps.msgList.messages.find(m => m.role === 'user')!;

      await runner.editAndSendMessage(firstUser.id, 'Edited first');

      const users = deps.msgList.messages.filter(m => m.role === 'user');
      expect(users.length).toBe(1);
      expect(users[0].content).toBe('Edited first');
    });

    it('rejects empty edit text', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('First');
      const firstUser = deps.msgList.messages.find(m => m.role === 'user')!;

      await runner.editAndSendMessage(firstUser.id, '   ');
      const users = deps.msgList.messages.filter(m => m.role === 'user');
      expect(users[0].content).toBe('First');
    });

    it('ignores nonexistent messageId', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('First');
      const lenBefore = deps.msgList.length;
      await runner.editAndSendMessage('fake-id', 'New');
      expect(deps.msgList.length).toBe(lenBefore);
    });

    it('does nothing when isLoading', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.sendMessage('First');
      const firstUser = deps.msgList.messages.find(m => m.role === 'user')!;
      const lenBefore = deps.msgList.length;
      deps.refs.isLoading = true;

      await runner.editAndSendMessage(firstUser.id, 'New');
      expect(deps.msgList.length).toBe(lenBefore);
    });
  });

  // ── injectToolResult ──────────────────────────────────────────────────────

  describe('injectToolResult', () => {
    it('pushes assistant + tool and runs the loop', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.injectToolResult('tc-1', 'echo', 'result-value');

      const tools = deps.msgList.messages.filter(m => m.role === 'tool');
      expect(tools.length).toBe(1);
      expect(tools[0].toolCall?.name).toBe('echo');
      expect(tools[0].toolCall?.result).toBe('result-value');
    });

    it('skips duplicate assistant when tool call already exists (exact ID match)', async () => {
      const tracker = createHistoryTracker([
        { role: 'assistant' as const, content: '', toolCalls: [{ id: 'tc-1', name: 'echo', arguments: {} }] },
        { role: 'tool' as const, toolCallId: 'tc-1', name: 'echo', content: 'old' },
      ]);
      const deps = makeDeps({ tracker });
      const runner = createConversationRunner(deps);

      await runner.injectToolResult('tc-1', 'echo', 'new result');

      const tools = deps.msgList.messages.filter(m => m.role === 'tool');
      expect(tools.length).toBe(1);
      expect(tools[0].toolCall?.result).toBe('new result');
    });

    it('replaces cancelled result with real answer when toolCallId matches (restore bug fix)', async () => {
      // This tests the EXACT bug scenario: session restored with pending
      // ask_user, orphaned tool call sealed as {cancelled:true}, then user
      // answers using the SAME toolCallId as the original LLM call.
      //
      // Before the fix, injectToolResult would push a SECOND tool result
      // for the same toolCallId, causing API 400 errors like:
      // "Messages with role 'tool' must be a response to a preceding
      //  message with 'tool_calls'"
      const tracker = createHistoryTracker([
        { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_00_ask', name: 'ask_user', arguments: { type: 'text', question: 'Hello?' } }] },
      ]);
      // Tracker constructor auto-sealed the orphaned call with {cancelled:true}

      const deps = makeDeps({ tracker });
      const runner = createConversationRunner(deps);

      // The user answers with the SAME toolCallId as the original
      await runner.injectToolResult('call_00_ask', 'ask_user', 'user answer 111');

      const liveHistory = deps.tracker.getLiveHistory();
      const liveTools = liveHistory.filter((m) => m.role === 'tool');

      // Must have exactly ONE tool result for this toolCallId — not two
      expect(liveTools.length).toBe(1);
      expect(liveTools[0].toolCallId).toBe('call_00_ask');
      expect(liveTools[0].content).toBe('user answer 111');

      // Assistant must still have the original tool call
      const liveAssistants = liveHistory.filter((m) => m.role === 'assistant');
      expect(liveAssistants.length).toBe(1);
      expect(liveAssistants[0].toolCalls?.[0].id).toBe('call_00_ask');
    });

    it('creates a fresh assistant+result when restored orphaned tool call is already cancelled', async () => {
      // Simulates the real-world restore scenario:
      // - History has assistant msg with LLM's tool call id (e.g. "call_00_...")
      // - `injectToolResult` is called with a DIFFERENT id (the ghost entry's UUID)
      // - Since orphaned tool calls are now sealed as "cancelled" on restore,
      //   the old call already has a result → injectToolResult creates a fresh
      //   assistant+result pair instead of reusing the old one
      const tracker = createHistoryTracker([
        { role: 'assistant' as const, content: 'Thinking...', thinking: 'deep thought', toolCalls: [{ id: 'call_00_original', name: 'ask_user', arguments: { type: 'text', question: 'Hello?' } }] },
      ]);
      const deps = makeDeps({ tracker });
      const runner = createConversationRunner(deps);

      await runner.injectToolResult('uuid-ghost-id', 'ask_user', 'user answer');

      // Check the TRACKER (source of truth) — not msgList (has mock-loop noise)
      const liveHistory = deps.tracker.getLiveHistory();

      // The original orphaned call was sealed as cancelled at tracker init,
      // so injectToolResult creates a NEW assistant + tool result pair.
      // Total: 2 assistants (original sealed + new), 2 tools (cancelled + new)
      const liveAssistants = liveHistory.filter(m => m.role === 'assistant');
      expect(liveAssistants.length).toBe(2);

      // First assistant preserved the original tool call
      expect(liveAssistants[0].toolCalls?.[0].id).toBe('call_00_original');

      // Second assistant was created by injectToolResult (new tool call)
      expect(liveAssistants[1].toolCalls?.[0].id).toBe('uuid-ghost-id');

      // First tool: the sealed cancelled result
      const liveTools = liveHistory.filter(m => m.role === 'tool');
      expect(liveTools.length).toBe(2);
      expect(JSON.parse(liveTools[0].content as string)).toEqual({ cancelled: true });
      // Second tool: the injected result
      expect(liveTools[1].toolCallId).toBe('uuid-ghost-id');
      expect(liveTools[1].content).toBe('user answer');

      // FULL history should also have the same structure
      const fullHistory = deps.tracker.getFullHistory();
      const fullAssistants = fullHistory.filter(m => m.role === 'assistant');
      expect(fullAssistants.length).toBe(2);
    });

    it('does NOT match by name when the tool call is already resolved', async () => {
      const tracker = createHistoryTracker([
        { role: 'assistant' as const, content: 'Old thinking', toolCalls: [{ id: 'call_00_resolved', name: 'ask_user', arguments: {} }] },
        { role: 'tool' as const, toolCallId: 'call_00_resolved', name: 'ask_user', content: 'old answer' },
      ]);
      const deps = makeDeps({ tracker });
      const runner = createConversationRunner(deps);

      await runner.injectToolResult('new-call-id', 'ask_user', 'new answer');

      // Since call_00_resolved already has a tool result, it's resolved —
      // should create a NEW assistant + tool pair
      const liveHistory = deps.tracker.getLiveHistory();
      const liveAssistants = liveHistory.filter(m => m.role === 'assistant');
      expect(liveAssistants.length).toBe(2);
      // Original assistant preserved
      expect(liveAssistants[0].content).toBe('Old thinking');
      // New synthetic assistant added
      expect(liveAssistants[1].content).toBe('');
    });

    it('creates new assistant when neither ID nor name matches', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      await runner.injectToolResult('brand-new-id', 'unregistered_tool', 'result');

      const liveHistory = deps.tracker.getLiveHistory();
      const liveAssistants = liveHistory.filter(m => m.role === 'assistant');
      expect(liveAssistants.length).toBe(1);
      expect(liveAssistants[0].content).toBe('');

      const liveTools = liveHistory.filter(m => m.role === 'tool');
      expect(liveTools.length).toBe(1);
      expect(liveTools[0].name).toBe('unregistered_tool');
    });

    it('skips when isLoading', async () => {
      const deps = makeDeps();
      deps.refs.isLoading = true;
      const runner = createConversationRunner(deps);

      await runner.injectToolResult('tc-1', 'echo', 'result');
      expect(deps.msgList.length).toBe(0);
    });
  });

  // ── lastRun ───────────────────────────────────────────────────────────────

  describe('lastRun', () => {
    it('is undefined before any send', () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);
      expect(runner.lastRun).toBeUndefined();
    });

    it('exposes turn count and toolCallCount after sendMessage', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);
      await runner.sendMessage('Hi');
      expect(runner.lastRun).toBeDefined();
      expect(runner.lastRun!.turns).toBeGreaterThanOrEqual(1);
      expect(runner.lastRun!.toolCallCount).toBeGreaterThanOrEqual(0);
    });

    it('exposes completed=true on successful run', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);
      await runner.sendMessage('Hi');
      expect(runner.lastRun!.completed).toBe(true);
    });
  });

  // ── onTurnSnapshot (immediate commit) ────────────────────────────────────

  describe('onTurnSnapshot (immediate commit)', () => {
    it('flushes assistant message with tool calls to tracker immediately', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      // Custom loop that calls onTurnSnapshot with an assistant message that
      // includes tool calls — simulating what agentLoopCore does right before
      // tool execution.
      const assistantWithTools: AgentMessage = {
        role: 'assistant',
        content: 'Let me ask...',
        toolCalls: [{ id: 'call-1', name: 'ask_user', arguments: {} }],
      };

      mockRunLoop.mockImplementationOnce(async (config: any) => {
        // Push user message to history (simulating what real loop does)
        const historyWithTools = [...config.initialHistory, assistantWithTools];

        // onTurnSnapshot fires here (as in the real agentLoopCore)
        config.hooks?.onTurnSnapshot?.([...historyWithTools]);

        // Simulate tool execution starting (would suspend in real code)
        config.hooks?.onAssistantText?.('Let me ask...', undefined);
        config.hooks?.onStreamEnd?.();

        const afterTurnResult = await config.hooks?.onAfterTurn?.(
          historyWithTools, undefined, new AbortController().signal,
        );

        return {
          output: 'Let me ask...',
          turns: 1,
          toolCallCount: 1,
          history: afterTurnResult ?? historyWithTools,
          completed: true,
        };
      });

      await runner.sendMessage('Test');

      // The tracker should ALREADY have the assistant message because
      const fullHistory = deps.tracker.getFullHistory();
      expect(fullHistory.length).toBeGreaterThanOrEqual(2);
      const lastMsg = fullHistory[fullHistory.length - 1];
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.content).toBe('Let me ask...');
      expect((lastMsg as { toolCalls?: unknown[] }).toolCalls).toHaveLength(1);
    });

    it('committed data is also reflected in liveHistory', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      const assistantWithTools: AgentMessage = {
        role: 'assistant',
        content: 'Analysis...',
        toolCalls: [{ id: 'c1', name: 'search', arguments: {} }],
      };

      mockRunLoop.mockImplementationOnce(async (config: any) => {
        const historyWithTools = [...config.initialHistory, assistantWithTools];
        config.hooks?.onTurnSnapshot?.([...historyWithTools]);
        config.hooks?.onAssistantText?.('Analysis...', undefined);
        config.hooks?.onStreamEnd?.();
        const afterTurnResult = await config.hooks?.onAfterTurn?.(
          historyWithTools, undefined, new AbortController().signal,
        );
        return {
          output: 'Analysis...',
          turns: 1,
          toolCallCount: 1,
          history: afterTurnResult ?? historyWithTools,
          completed: true,
        };
      });

      await runner.sendMessage('Test');

      const liveHistory = deps.tracker.getLiveHistory();
      // liveHistory should also be updated by advanceTurn
      const lastMsg = liveHistory[liveHistory.length - 1];
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.content).toBe('Analysis...');
    });

    // ── CRITICAL: User's reported failure scenario ─────────────────────────
    // When ask_user suspends, persistence fires before the tool completes.
    // getHistory() must return the assistant message, not just the user msg.

    it('getHistory includes assistant message when tool suspends (ask_user scenario)', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);
      let toolSuspended = false;

      mockRunLoop.mockImplementationOnce(async (config: any) => {
        // Simulate agentLoopCore: push assistant message with tool call
        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: '请问您想咨询什么问题？',
          toolCalls: [{ id: 'call-ask', name: 'ask_user', arguments: {} }],
        };
        const historyWithTools = [...config.initialHistory, assistantMsg];

        // Fire onTurnSnapshot — as agentLoopCore does right before tool execution
        config.hooks?.onTurnSnapshot?.([...historyWithTools]);
        toolSuspended = true;

        // The tool is now "suspended" — agentLoopCore's local history has the
        // assistant message but the tracker doesn't yet (that's the bug).
        // In the real code, the tool never resolves, but for this test we
        // simulate the full cycle: tool resolves → loop completes.
        config.hooks?.onAssistantText?.('请问您想咨询什么问题？', undefined);
        config.hooks?.onStreamEnd?.();

        const afterTurnResult = await config.hooks?.onAfterTurn?.(
          historyWithTools, undefined, new AbortController().signal,
        );

        return {
          output: '请问您想咨询什么问题？',
          turns: 1,
          toolCallCount: 1,
          history: afterTurnResult ?? historyWithTools,
          completed: true,
        };
      });

      await runner.sendMessage('Test');

      // Simulate what persistence does: call getHistory() on the session.
      // The tracker should already have the assistant message because
      // onTurnSnapshot committed it immediately.
      const fullHistory = deps.tracker.getFullHistory();

      // ✅ VERIFY: assistant message is in the history
      const assistantMsgs = fullHistory.filter((m) => m.role === 'assistant');
      expect(assistantMsgs).toHaveLength(1);
      expect(assistantMsgs[0].content).toBe('请问您想咨询什么问题？');
      expect((assistantMsgs[0] as { toolCalls?: unknown[] }).toolCalls).toHaveLength(1);

      // ✅ VERIFY: tool call ID is preserved
      const toolCalls = (assistantMsgs[0] as { toolCalls?: readonly ToolCall[] }).toolCalls;
      expect(toolCalls?.[0]?.id).toBe('call-ask');
      expect(toolCalls?.[0]?.name).toBe('ask_user');

      // ✅ VERIFY: user message is still first
      expect(fullHistory[0]).toMatchObject({ role: 'user', content: 'Test' });
    });

    it('getHistory includes full turn data after tool completes (resume scenario)', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      mockRunLoop.mockImplementationOnce(async (config: any) => {
        // Turn 0: assistant message with tool call + onTurnSnapshot
        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: 'Searching...',
          toolCalls: [{ id: 'c1', name: 'web_search', arguments: {} }],
        };
        const historyWithTools = [...config.initialHistory, assistantMsg];
        config.hooks?.onTurnSnapshot?.([...historyWithTools]);

        // Simulate persistence calling getHistory() while tool is pending
        // (This is what happens in the real scenario)
        // onTurnSnapshot already committed the assistant message to the tracker

        config.hooks?.onAssistantText?.('Searching...', undefined);
        config.hooks?.onStreamEnd?.();

        // Tool completes, push tool result to history
        const toolResultMsg: AgentMessage = {
          role: 'tool',
          toolCallId: 'c1',
          name: 'web_search',
          content: 'search results',
        };
        const historyWithResults = [...historyWithTools, toolResultMsg];

        const afterTurnResult = await config.hooks?.onAfterTurn?.(
          historyWithResults, undefined, new AbortController().signal,
        );

        return {
          output: 'Searching...',
          turns: 1,
          toolCallCount: 1,
          history: afterTurnResult ?? historyWithResults,
          completed: true,
        };
      });

      await runner.sendMessage('Test');

      // After both tools complete and loop finishes, full history should
      // contain: [user_msg, assistant_msg, tool_result]
      const fullHistory = deps.tracker.getFullHistory();

      expect(fullHistory).toHaveLength(3);
      expect(fullHistory[0].role).toBe('user');
      expect(fullHistory[1].role).toBe('assistant');
      expect(fullHistory[1].content).toBe('Searching...');
      expect(fullHistory[2].role).toBe('tool');
      expect(fullHistory[2].content).toBe('search results');
    });

    it('getHistory preserves assistant message across agent loop completion', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      // Simulate two-turn agent loop: tool turn + completion turn
      mockRunLoop.mockImplementationOnce(async (config: any) => {
        // Turn 0: tool call
        const turn0Assistant: AgentMessage = {
          role: 'assistant',
          content: 'Asking...',
          toolCalls: [{ id: 'c1', name: 'ask_user', arguments: {} }],
        };
        const turn0History = [...config.initialHistory, turn0Assistant];
        config.hooks?.onTurnBegin?.(0);
        config.hooks?.onTurnSnapshot?.([...turn0History]);

        // Persistence fires HERE in real code — onTurnSnapshot captures the data

        config.hooks?.onAssistantText?.('Asking...', undefined);
        config.hooks?.onStreamEnd?.();

        // Tool result arrives
        const toolResultMsg: AgentMessage = {
          role: 'tool', toolCallId: 'c1', name: 'ask_user', content: 'yes',
        };
        const afterTurn0 = await config.hooks?.onAfterTurn?.(
          [...turn0History, toolResultMsg], undefined, new AbortController().signal,
        );
        const afterTurn0History = afterTurn0 ?? [...turn0History, toolResultMsg];

        // Turn 1: final response (no tools)
        config.hooks?.onTurnBegin?.(1);
        config.hooks?.onAssistantText?.('Thanks!', undefined);
        config.hooks?.onStreamEnd?.();

        const afterTurn1 = await config.hooks?.onAfterTurn?.(
          [...afterTurn0History, { role: 'assistant', content: 'Thanks!' }],
          undefined, new AbortController().signal,
        );

        return {
          output: 'Thanks!',
          turns: 2,
          toolCallCount: 1,
          history: afterTurn1 ?? [...afterTurn0History, { role: 'assistant', content: 'Thanks!' }],
          completed: true,
        };
      });

      await runner.sendMessage('Test');

      // Final full history must contain ALL messages
      const fullHistory = deps.tracker.getFullHistory();

      expect(fullHistory.length).toBeGreaterThanOrEqual(3);
      const roles = fullHistory.map((m) => m.role);
      expect(roles.filter((r) => r === 'assistant')).toHaveLength(2);
      expect(roles.filter((r) => r === 'user')).toHaveLength(1);

      // The first assistant message (from the tool turn) must have toolCalls
      const firstAssistant = fullHistory.find((m) => m.role === 'assistant' && m.content === 'Asking...');
      expect(firstAssistant).toBeDefined();
      expect((firstAssistant as { toolCalls?: unknown[] } | undefined)?.toolCalls).toHaveLength(1);
    });

    it('onTurnSnapshot does NOT fire when no tool calls (natural completion)', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);

      mockRunLoop.mockImplementationOnce(async (config: any) => {
        // No onTurnSnapshot called — simulating natural completion without tools
        config.hooks?.onAssistantText?.('done', undefined);
        config.hooks?.onStreamEnd?.();
        const afterTurnResult = await config.hooks?.onAfterTurn?.(
          config.initialHistory, undefined, new AbortController().signal,
        );
        return {
          output: 'done',
          turns: 1,
          toolCallCount: 0,
          history: afterTurnResult ?? config.initialHistory,
          completed: true,
        };
      });

      await runner.sendMessage('Test');

      // Only user message in tracker
      const fullHistory = deps.tracker.getFullHistory();
      expect(fullHistory.filter(m => m.role === 'assistant')).toHaveLength(0);
    });

    it('multi-turn: each tool turn immediately commits to tracker', async () => {
      const deps = makeDeps();
      const runner = createConversationRunner(deps);
      let snapshotCount = 0;

      mockRunLoop.mockImplementationOnce(async (config: any) => {
        // Turn 0 with tools
        const turn0Msg: AgentMessage = {
          role: 'assistant',
          content: 'Turn 0',
          toolCalls: [{ id: 'c0', name: 'tool_a', arguments: {} }],
        };
        const turn0History = [...config.initialHistory, turn0Msg];
        config.hooks?.onTurnBegin?.(0);
        config.hooks?.onTurnSnapshot?.([...turn0History]);
        snapshotCount++;

        config.hooks?.onAssistantText?.('Turn 0', undefined);
        config.hooks?.onStreamEnd?.();
        const afterTurn0 = await config.hooks?.onAfterTurn?.(
          turn0History, undefined, new AbortController().signal,
        );

        // Turn 1 with tools
        const turn1Base = afterTurn0 ?? turn0History;
        config.hooks?.onTurnBegin?.(1);
        const turn1Msg: AgentMessage = {
          role: 'assistant',
          content: 'Turn 1',
          toolCalls: [{ id: 'c1', name: 'tool_b', arguments: {} }],
        };
        const turn1History = [...turn1Base, turn1Msg];
        config.hooks?.onTurnSnapshot?.([...turn1History]);
        snapshotCount++;

        config.hooks?.onAssistantText?.('Turn 1', undefined);
        config.hooks?.onStreamEnd?.();
        const afterTurn1 = await config.hooks?.onAfterTurn?.(
          turn1History, undefined, new AbortController().signal,
        );

        return {
          output: 'Turn 1',
          turns: 2,
          toolCallCount: 2,
          history: afterTurn1 ?? turn1History,
          completed: true,
        };
      });

      await runner.sendMessage('Test');

      expect(snapshotCount).toBe(2);
      const fullHistory = deps.tracker.getFullHistory();
      // Both assistant messages should be in the tracker (committed immediately)
      const assistants = fullHistory.filter(m => m.role === 'assistant');
      expect(assistants.length).toBe(2);
      expect(assistants[0].content).toBe('Turn 0');
      expect(assistants[1].content).toBe('Turn 1');
    });
  });

  // ── scope integration ─────────────────────────────────────────────────────

  describe('scope integration', () => {
    it('calls scope.beforeRun and scope.afterRun', async () => {
      const beforeRun = vi.fn();
      const afterRun = vi.fn();
      const scope = makeScope({ beforeRun, afterRun });

      mockRunEngine.mockImplementationOnce(async (
        refs: EngineRefs,
        hooks: EngineHooks,
        run: (signal: AbortSignal) => Promise<EngineRunResult>,
        notify: () => void,
      ): Promise<void> => {
        hooks.onBeforeRun?.();
        refs.isLoading = true; notify();
        const result = await run(new AbortController().signal);
        refs.isLoading = false; notify();
        hooks.onAfterRun?.(result.outcome);
      });

      const deps = makeDeps({ scope });
      const runner = createConversationRunner(deps);
      await runner.sendMessage('Test');

      expect(beforeRun).toHaveBeenCalled();
      expect(afterRun).toHaveBeenCalled();
    });

    it('scope.interceptMessage blocks send', async () => {
      const interceptMessage = vi.fn(() => true);
      const deps = makeDeps({ onInterceptMessage: interceptMessage });
      const runner = createConversationRunner(deps);

      await runner.sendMessage('Blocked');
      expect(deps.msgList.length).toBe(0);
    });
  });
});
