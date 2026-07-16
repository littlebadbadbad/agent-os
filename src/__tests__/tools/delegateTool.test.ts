/**
 * Unit tests for delegateTool.ts — the Delegate Task Tool.
 */

import { describe, it, expect, vi } from 'vitest';
import { createDelegateTaskTool } from '../../tools/subagent/delegateTool';
import type { Tool, ToolExecutionContext } from '@agent-type';

describe('createDelegateTaskTool', () => {
  const SESSION_ID = 'sess-1';

  function makeDeps() {
    const registry = {
      createSubAgent: vi.fn(() => ({
        getState: vi.fn(() => ({ conversationId: 'conv-new' })),
      })),
      sendMessage: vi.fn(() => Promise.resolve({ output: 'task result', turns: 2, toolCallCount: 3, history: [] })),
      deleteSubAgent: vi.fn(),
    };

    return {
      getRegistry: vi.fn(() => registry),
      getEffectivePool: vi.fn(() => new Map<string, Tool>([
        ['tool_a', { name: 'tool_a', description: '', parameters: {} as any, execute: async () => {} }],
        ['tool_b', { name: 'tool_b', description: '', parameters: {} as any, execute: async () => {} }],
      ])),
      registry,
    };
  }

  function makeCtx(overrides?: Partial<ToolExecutionContext>): ToolExecutionContext {
    return {
      sessionId: SESSION_ID,
      agentName: 'main',
      conversationId: 'main',
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      ...overrides,
    } as unknown as ToolExecutionContext;
  }

  it('creates a tool named delegate_<suffix>_task', () => {
    const deps = makeDeps();
    const tool = createDelegateTaskTool('test', deps);
    expect(tool.name).toBe('delegate_test_task');
    expect(tool.parameters).toBeDefined();
  });

  it('creates ephemeral sub-agent, sends task, returns result', async () => {
    const deps = makeDeps();
    const tool = createDelegateTaskTool('test', deps);

    const result = await tool.execute({ task: 'do something', max_turns: 5 }, makeCtx()) as any;

    expect(result.result).toBe('task result');
    expect(result.turns).toBe(2);
    expect(result.tool_calls).toBe(3);

    // Verify registry interactions
    expect(deps.getRegistry).toHaveBeenCalledWith(SESSION_ID);
    expect(deps.registry.createSubAgent).toHaveBeenCalledOnce();
    expect(deps.registry.sendMessage).toHaveBeenCalledOnce();
    expect(deps.registry.deleteSubAgent).toHaveBeenCalledOnce();
  });

  it('appends optional context to the task message', async () => {
    const deps = makeDeps();
    const tool = createDelegateTaskTool('test', deps);

    await tool.execute({ task: 'do something', context: 'background info', max_turns: 5 }, makeCtx());

    const [, , message] = deps.registry.sendMessage.mock.calls[0];
    expect(message).toContain('do something');
    expect(message).toContain('background info');
    expect(message).toContain('Context (what is already known)');
  });

  it('excludes the delegate tool itself from the tool pool', async () => {
    const deps = makeDeps();
    deps.getEffectivePool = vi.fn(() => new Map([
      ['tool_a', { name: 'tool_a' } as Tool],
      ['delegate_test_task', { name: 'delegate_test_task' } as Tool],
    ]));

    const tool = createDelegateTaskTool('test', deps);
    await tool.execute({ task: 'do something' }, makeCtx());

    const createCall = deps.registry.createSubAgent.mock.calls[0][0];
    expect(createCall.toolNames).not.toContain('delegate_test_task');
    expect(createCall.toolNames).toContain('tool_a');
  });

  it('truncates long task description to 80 chars', async () => {
    const deps = makeDeps();
    const tool = createDelegateTaskTool('test', deps);

    const longTask = 'a'.repeat(200);
    await tool.execute({ task: longTask }, makeCtx());

    const createCall = deps.registry.createSubAgent.mock.calls[0][0];
    // "Ephemeral delegate: " (20) + task.slice(0,80) + "…" (1) = 101
    expect(createCall.description.length).toBe(101);
    expect(createCall.description).toContain('…');
  });

  it('cleans up even when sendMessage throws', async () => {
    const deps = makeDeps();
    deps.registry.sendMessage = vi.fn(() => Promise.reject(new Error('handler error')));
    const tool = createDelegateTaskTool('test', deps);

    await expect(tool.execute({ task: 'task' }, makeCtx())).rejects.toThrow('handler error');
    // deleteSubAgent should still be called (finally block)
    expect(deps.registry.deleteSubAgent).toHaveBeenCalled();
  });

  it('ignores deleteSubAgent errors during cleanup', async () => {
    const deps = makeDeps();
    deps.registry.deleteSubAgent = vi.fn(() => { throw new Error('cleanup fail'); });
    const tool = createDelegateTaskTool('test', deps);

    // Should not throw despite cleanup error
    const result = await tool.execute({ task: 'task' }, makeCtx()) as any;
    expect(result.result).toBe('task result');
  });
});
