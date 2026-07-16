/**
 * Unit tests for {@link ConversationRunner}.
 *
 * Mocks `runEngine` and `runAgentLoopCore` to test the runner's orchestration
 * in isolation: sendMessage / editAndSendMessage / injectToolResult flow,
 * streaming hooks, error handling, intercept guards.
 *
 * The runner is the single shared execution core for BOTH the main agent and
 * sub-agent paths.
 */

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

    it('skips duplicate assistant when tool call already exists', async () => {
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
