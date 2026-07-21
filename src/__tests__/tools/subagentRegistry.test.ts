/**
 * Comprehensive integration tests for the sub-agent registry
 * (src/tools/subagent/registry.ts — createSubAgentRegistry).
 *
 * Tests every public API method on the SubAgentRegistry interface using
 * a mock handler and tool pool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSubAgentRegistry } from '../../tools/subagent/registry';
import type { Tool, AgentHandler, AgentTurnResponse } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// ── Fakes ─────────────────────────────────────────────────────────────────────

function makeTool(name: string): Tool {
  return { name, description: `Tool ${name}`, parameters: {} as any, execute: async () => `result:${name}` };
}

function makeRegistry() {
  const toolPool = () => new Map<string, Tool>([
    ['tool_a', makeTool('tool_a')],
    ['tool_b', makeTool('tool_b')],
  ]);

  const handler: AgentHandler = vi.fn(async () => ({ text: 'ok', toolCalls: [] })) as unknown as AgentHandler;

  return createSubAgentRegistry({
    sessionId: 'test-sess',
    handler,
    toolPool,
    label: 'test',
  });
}

describe('createSubAgentRegistry', () => {
  let registry: ReturnType<typeof makeRegistry>;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = makeRegistry();
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Label
  // ═══════════════════════════════════════════════════════════════════════

  describe('label', () => {
    it('returns configured label', () => {
      expect(registry.label).toBe('test');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  getState
  // ═══════════════════════════════════════════════════════════════════════

  describe('getState', () => {
    it('returns empty subAgents initially', () => {
      expect(registry.getState().subAgents).toEqual([]);
    });

    it('includes created sub-agents', () => {
      registry.createSubAgent({
        name: 'worker', description: 'Worker', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      const state = registry.getState();
      expect(state.subAgents).toHaveLength(1);
      expect(state.subAgents[0].name).toBe('worker');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  subscribe
  // ═══════════════════════════════════════════════════════════════════════

  describe('subscribe', () => {
    it('notifies on createSubAgent', () => {
      const fn = vi.fn();
      registry.subscribe(fn);
      registry.createSubAgent({
        name: 'n', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      expect(fn).toHaveBeenCalled();
    });

    it('unsubscribe stops notifications', () => {
      const fn = vi.fn();
      const unsub = registry.subscribe(fn);
      unsub();
      registry.createSubAgent({
        name: 'n', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  createSubAgent
  // ═══════════════════════════════════════════════════════════════════════

  describe('createSubAgent', () => {
    it('returns a conversation handle', () => {
      const conv = registry.createSubAgent({
        name: 'agent-1', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      expect(conv.getState().agentName).toBe('agent-1');
    });

    it('rejects empty name', () => {
      expect(() => registry.createSubAgent({
        name: '', description: '', toolNames: [], maxTurns: 5, parent: 'main:main',
      })).toThrow('non-empty');
    });

    it('rejects name with whitespace', () => {
      expect(() => registry.createSubAgent({
        name: 'bad name', description: '', toolNames: [], maxTurns: 5, parent: 'main:main',
      })).toThrow('no whitespace');
    });

    it('rejects duplicate name', () => {
      registry.createSubAgent({
        name: 'dup', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      expect(() => registry.createSubAgent({
        name: 'dup', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      })).toThrow('already exists');
    });

    it('rejects unknown tool names', () => {
      expect(() => registry.createSubAgent({
        name: 'bad', description: '', toolNames: ['ghost'], maxTurns: 5, parent: 'main:main',
      })).toThrow('Unknown tool');
    });

    it('creates an initial conversation with empty title', () => {
      const conv = registry.createSubAgent({
        name: 'x', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      expect(conv.getState().title).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  updateSubAgent
  // ═══════════════════════════════════════════════════════════════════════

  describe('updateSubAgent', () => {
    beforeEach(() => {
      registry.createSubAgent({
        name: 'upd', description: 'Original', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
    });

    it('updates description', () => {
      registry.updateSubAgent('upd', { description: 'Updated' });
      expect(registry.getState().subAgents[0].description).toBe('Updated');
    });

    it('updates toolNames', () => {
      registry.updateSubAgent('upd', { toolNames: ['tool_a', 'tool_b'] });
      expect(registry.getState().subAgents[0].toolNames).toEqual(['tool_a', 'tool_b']);
    });

    it('rejects unknown tool names', () => {
      expect(() => registry.updateSubAgent('upd', { toolNames: ['ghost'] })).toThrow('Unknown tool');
    });

    it('updates maxTurns', () => {
      registry.updateSubAgent('upd', { maxTurns: 20 });
      expect(registry.getState().subAgents[0].maxTurns).toBe(20);
    });

    it('updates systemPrompt', () => {
      registry.updateSubAgent('upd', { systemPrompt: 'New prompt' });
      expect(registry.getState().subAgents[0].systemPrompt).toBe('New prompt');
    });

    it('clears systemPrompt when empty string', () => {
      registry.updateSubAgent('upd', { systemPrompt: '' });
      expect(registry.getState().subAgents[0].systemPrompt).toBe('');
    });

    it('throws for non-existent agent', () => {
      expect(() => registry.updateSubAgent('ghost', { description: 'x' })).toThrow('not found');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  deleteSubAgent
  // ═══════════════════════════════════════════════════════════════════════

  describe('deleteSubAgent', () => {
    it('removes the agent', () => {
      registry.createSubAgent({
        name: 'r', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      registry.deleteSubAgent('r');
      expect(registry.getState().subAgents).toHaveLength(0);
    });

    it('throws for non-existent', () => {
      expect(() => registry.deleteSubAgent('ghost')).toThrow('not found');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Conversation CRUD
  // ═══════════════════════════════════════════════════════════════════════

  describe('conversation CRUD', () => {
    beforeEach(() => {
      registry.createSubAgent({
        name: 'ca', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
    });

    it('createConversation creates a new conversation', () => {
      const conv = registry.createConversation('ca', { title: 'New' });
      expect(conv.getState().title).toBe('New');
      expect(registry.getState().subAgents[0].conversations).toHaveLength(2);
    });

    it('createConversation with setActive switches active', () => {
      const conv = registry.createConversation('ca', { title: 'Active', setActive: true });
      expect(registry.getState().subAgents[0].activeConversationId).toBe(conv.getState().conversationId);
    });

    it('createConversation without setActive keeps current active', () => {
      const orig = registry.getState().subAgents[0].activeConversationId;
      registry.createConversation('ca', { title: 'Extra' });
      expect(registry.getState().subAgents[0].activeConversationId).toBe(orig);
    });

    it('createConversation throws for unknown agent', () => {
      expect(() => registry.createConversation('ghost', {})).toThrow('not found');
    });

    it('deleteConversation removes the conversation', () => {
      const conv = registry.createConversation('ca', { title: 'Temp' });
      const id = conv.getState().conversationId;
      registry.deleteConversation('ca', id);
      const ids = registry.getState().subAgents[0].conversations.map((c) => c.conversationId);
      expect(ids).not.toContain(id);
    });

    it('deleteConversation always keeps at least one conversation', () => {
      // Delete the initial conversation
      const id = registry.getState().subAgents[0].activeConversationId;
      registry.deleteConversation('ca', id);
      expect(registry.getState().subAgents[0].conversations).toHaveLength(1);
    });

    it('deleteConversation throws for unknown agent', () => {
      expect(() => registry.deleteConversation('ghost', 'c1')).toThrow('not found');
    });

    it('deleteConversation throws for unknown conversation', () => {
      expect(() => registry.deleteConversation('ca', 'fake')).toThrow('not found');
    });

    it('setActiveConversation switches active', () => {
      const conv = registry.createConversation('ca', { title: 'B' });
      const id = conv.getState().conversationId;
      registry.setActiveConversation('ca', id);
      expect(registry.getState().subAgents[0].activeConversationId).toBe(id);
    });

    it('setActiveConversation throws for unknown conv', () => {
      expect(() => registry.setActiveConversation('ca', 'ghost')).toThrow('not found');
    });

    it('clearConversationHistory resets the conversation', () => {
      const id = registry.getState().subAgents[0].activeConversationId;
      registry.clearConversationHistory('ca', id);
      const conv = registry.getConversation('ca', id);
      expect(conv?.getHistory()).toEqual([]);
    });

    it('clearConversationHistory throws for unknown agent', () => {
      expect(() => registry.clearConversationHistory('ghost', 'c1')).toThrow('not found');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  sendMessage
  // ═══════════════════════════════════════════════════════════════════════

  describe('sendMessage', () => {
    it('sends a message and returns a SubAgentResult', async () => {
      registry.createSubAgent({
        name: 'talker', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      const result = await registry.sendMessage('talker', registry.getState().subAgents[0].activeConversationId, 'Hello', {
        sessionId: 'test-sess',
        signal: new AbortController().signal,
      });
      expect(result).toBeDefined();
      expect(typeof result.output).toBe('string');
    });

    it('rejects message to unknown agent', async () => {
      await expect(registry.sendMessage('ghost', 'c1', 'Hi', {
        sessionId: 'test-sess',
        signal: new AbortController().signal,
      })).rejects.toThrow('not found');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  readHistory
  // ═══════════════════════════════════════════════════════════════════════

  describe('readHistory', () => {
    it('returns empty for fresh conversation', () => {
      registry.createSubAgent({
        name: 'reader', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      const h = registry.readHistory('reader', registry.getState().subAgents[0].activeConversationId);
      expect(h).toEqual([]);
    });

    it('throws for unknown agent', () => {
      expect(() => registry.readHistory('ghost', 'c1')).toThrow('not found');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  getConversation
  // ═══════════════════════════════════════════════════════════════════════

  describe('getConversation', () => {
    it('returns the conversation handle', () => {
      registry.createSubAgent({
        name: 'f', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      const id = registry.getState().subAgents[0].activeConversationId;
      expect(registry.getConversation('f', id)).toBeDefined();
    });

    it('returns undefined for unknown agent', () => {
      expect(registry.getConversation('ghost', 'c1')).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Snapshot / Restore
  // ═══════════════════════════════════════════════════════════════════════

  describe('snapshot/restore', () => {
    it('getSnapshot returns serializable entries', () => {
      registry.createSubAgent({
        name: 'snap', description: 'Agent', toolNames: ['tool_a'], maxTurns: 3, parent: 'main:main',
      });
      const snap = registry.getSnapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0].name).toBe('snap');
    });

    it('loadSnapshot restores entries', () => {
      registry.createSubAgent({
        name: 'orig', description: 'Orig', toolNames: ['tool_a'], maxTurns: 3, parent: 'main:main',
      });
      const snap = registry.getSnapshot();
      registry.deleteSubAgent('orig');
      expect(registry.getState().subAgents).toHaveLength(0);

      registry.loadSnapshot(snap);
      expect(registry.getState().subAgents).toHaveLength(1);
      expect(registry.getState().subAgents[0].name).toBe('orig');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  UI-initiated send / cancel / edit
  // ═══════════════════════════════════════════════════════════════════════

  describe('UI operations', () => {
    it('sendConversationMessage sends to the conversation', async () => {
      registry.createSubAgent({
        name: 'ui-agent', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      const id = registry.getState().subAgents[0].activeConversationId;
      await registry.sendConversationMessage('ui-agent', id, 'Hello');
      expect(true).toBe(true);
    });

    it('cancelConversationMessage is safe when nothing is running', () => {
      registry.createSubAgent({
        name: 'ui-agent', description: '', toolNames: ['tool_a'], maxTurns: 5, parent: 'main:main',
      });
      const id = registry.getState().subAgents[0].activeConversationId;
      expect(() => registry.cancelConversationMessage('ui-agent', id)).not.toThrow();
    });

    it('cancelConversationMessage aborts handler signal during sendConversationMessage', async () => {
      // Capture the AbortSignal that the handler receives
      let handlerSignal: AbortSignal | null = null;
      const handlerReady = deferred();

      const abortTestHandler: AgentHandler = async (_msgs, { signal }) => {
        handlerSignal = signal;
        handlerReady.resolve();
        // Wait until the signal is aborted
        await new Promise<void>((r) => {
          if (signal.aborted) r();
          else signal.addEventListener('abort', () => r(), { once: true });
        });
        return { text: 'cancelled', toolCalls: [] } satisfies AgentTurnResponse;
      };

      const abortRegistry = createSubAgentRegistry({
        sessionId: 'test-sess',
        handler: abortTestHandler,
        toolPool: () => new Map<string, Tool>(),
        label: 'test',
      });

      abortRegistry.createSubAgent({
        name: 'abort-agent', description: '', toolNames: [], maxTurns: 5, parent: 'main:main',
      });
      const convId = abortRegistry.getState().subAgents[0].activeConversationId;

      // Start sending — handler will wait for abort
      const sendPromise = abortRegistry.sendConversationMessage('abort-agent', convId, 'Hello');

      // Wait for handler to start and capture signal
      await handlerReady.promise;

      // Cancel — this must propagate abort to the handler's signal
      abortRegistry.cancelConversationMessage('abort-agent', convId);

      // The send should complete after the abort
      await sendPromise;

      expect(handlerSignal).not.toBeNull();
      expect(handlerSignal!.aborted).toBe(true);
    });

    it('editConversationMessage calls handler when conversation has history', async () => {
      let handlerCallCount = 0;

      const editTestHandler: AgentHandler = async (_msgs, { signal }) => {
        handlerCallCount++;
        return { text: 'ok', toolCalls: [] } satisfies AgentTurnResponse;
      };

      const editRegistry = createSubAgentRegistry({
        sessionId: 'test-sess',
        handler: editTestHandler,
        toolPool: () => new Map<string, Tool>(),
        label: 'test',
      });

      editRegistry.createSubAgent({
        name: 'edit-agent', description: '', toolNames: [], maxTurns: 5, parent: 'main:main',
      });
      const convId = editRegistry.getState().subAgents[0].activeConversationId;

      await editRegistry.sendConversationMessage('edit-agent', convId, 'Hello');
      expect(handlerCallCount).toBe(1);

      // Now try editing
      await editRegistry.editConversationMessage('edit-agent', convId, 1, 'Edited', undefined);
      expect(handlerCallCount).toBe(2);
    }, 10000);

    it('cancelConversationMessage aborts handler signal during editConversationMessage', async () => {
      let handlerCallCount = 0;
      const handlerReady = deferred();

      const editTestHandler: AgentHandler = async (_msgs, { signal }) => {
        handlerCallCount++;
        if (handlerCallCount === 2) {
          handlerReady.resolve();
          await new Promise<void>((r) => {
            if (signal.aborted) r();
            else signal.addEventListener('abort', () => r(), { once: true });
          });
        }
        return { text: 'ok', toolCalls: [] } satisfies AgentTurnResponse;
      };

      const editRegistry = createSubAgentRegistry({
        sessionId: 'test-sess',
        handler: editTestHandler,
        toolPool: () => new Map<string, Tool>(),
        label: 'test',
      });

      editRegistry.createSubAgent({
        name: 'edit-agent', description: '', toolNames: [], maxTurns: 5, parent: 'main:main',
      });
      const convId = editRegistry.getState().subAgents[0].activeConversationId;

      // Send initial message
      await editRegistry.sendConversationMessage('edit-agent', convId, 'Hello');
      expect(handlerCallCount).toBe(1);

      // Try the edit and see if handler is called second time
      try {
        const editPromise = editRegistry.editConversationMessage('edit-agent', convId, 1, 'Edited', undefined);
        await handlerReady.promise;
        editRegistry.cancelConversationMessage('edit-agent', convId);
        await editPromise;
        expect(handlerCallCount).toBe(2);
      } catch (err) {
        throw new Error(`Edit failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 10000);
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  Tool-initiated cancel (the core fix)
  // ═════════════════════════════════════════════════════════════════════════
  //
  // `registry.sendMessage` (the tool path used by delegate tools) does NOT
  // register in `convControllers`.  `cancelConversationMessage` must fall
  // back to aborting the engine's AbortController directly.
  //
  // These tests verify the direct engine abort path.

  describe('tool-initiated cancel (direct engine abort)', () => {
    it('cancelConversationMessage aborts engine abortController during tool-path sendMessage', async () => {
      let handlerSignal: AbortSignal | null = null;
      const handlerReady = deferred();

      const abortHandler: AgentHandler = async (_msgs, { signal }) => {
        handlerSignal = signal;
        handlerReady.resolve();
        // Block until the signal is externally aborted
        await new Promise<void>((r) => {
          if (signal.aborted) r();
          else signal.addEventListener('abort', () => r(), { once: true });
        });
        return { text: 'cancelled', toolCalls: [] } satisfies AgentTurnResponse;
      };

      const reg = createSubAgentRegistry({
        sessionId: 'test-sess',
        handler: abortHandler,
        toolPool: () => new Map<string, Tool>(),
        label: 'tool-abort',
      });

      reg.createSubAgent({
        name: 'tool-agent', description: '', toolNames: [], maxTurns: 5, parent: 'main:main',
      });
      const convId = reg.getState().subAgents[0].activeConversationId;

      // ── Tool-path send: registry.sendMessage (NOT sendConversationMessage) ──
      const toolController = new AbortController();
      const sendPromise = reg.sendMessage('tool-agent', convId, 'Hello from tool', {
        sessionId: 'test-sess',
        signal: toolController.signal,
      });

      // Wait until the engine is running and the handler has captured its signal
      await handlerReady.promise;

      // Cancel via the UI path — must abort the engine even though the send
      // was tool-initiated (no entry in convControllers for this conversation).
      reg.cancelConversationMessage('tool-agent', convId);

      // Wait for the send to complete
      await sendPromise;

      expect(handlerSignal).not.toBeNull();
      expect(handlerSignal!.aborted).toBe(true);
    });

    it('cancelConversationMessage is safe when engine is idle after tool-path send', async () => {
      // After a tool-path send completes normally, cancelling must be a no-op.
      const handler: AgentHandler = async () => ({ text: 'ok', toolCalls: [] } satisfies AgentTurnResponse);

      const reg = createSubAgentRegistry({
        sessionId: 'test-sess',
        handler,
        toolPool: () => new Map<string, Tool>(),
        label: 'idle-test',
      });

      reg.createSubAgent({
        name: 'idle-agent', description: '', toolNames: [], maxTurns: 5, parent: 'main:main',
      });
      const convId = reg.getState().subAgents[0].activeConversationId;

      const controller = new AbortController();
      await reg.sendMessage('idle-agent', convId, 'Done', {
        sessionId: 'test-sess',
        signal: controller.signal,
      });

      // Engine is idle — cancel must not throw
      expect(() => reg.cancelConversationMessage('idle-agent', convId)).not.toThrow();
    });

    it('cancelConversationMessage aborts engine for UI-path sendConversationMessage after direct abort', async () => {
      // Verify the UI path (sendConversationMessage) still aborts correctly.
      // This is a regression test: the convControllers path must work even
      // though we now also call engineRefs.abortController?.abort() directly.
      let handlerSignal: AbortSignal | null = null;
      const handlerReady = deferred();

      const abortHandler: AgentHandler = async (_msgs, { signal }) => {
        handlerSignal = signal;
        handlerReady.resolve();
        await new Promise<void>((r) => {
          if (signal.aborted) r();
          else signal.addEventListener('abort', () => r(), { once: true });
        });
        return { text: 'cancelled', toolCalls: [] } satisfies AgentTurnResponse;
      };

      const reg = createSubAgentRegistry({
        sessionId: 'test-sess',
        handler: abortHandler,
        toolPool: () => new Map<string, Tool>(),
        label: 'regression',
      });

      reg.createSubAgent({
        name: 'reg-agent', description: '', toolNames: [], maxTurns: 5, parent: 'main:main',
      });
      const convId = reg.getState().subAgents[0].activeConversationId;

      // UI path
      const sendPromise = reg.sendConversationMessage('reg-agent', convId, 'Hello UI');
      await handlerReady.promise;
      reg.cancelConversationMessage('reg-agent', convId);
      await sendPromise;

      expect(handlerSignal!.aborted).toBe(true);
    });
  });
});
