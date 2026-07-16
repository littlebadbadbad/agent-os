/**
 * Unit tests for resolveConfig.ts — the AgentClientConfig resolver.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveAgentClientConfig } from '../../client/resolveConfig';
import type { AgentClientConfig } from '../../client/types';

describe('resolveAgentClientConfig', () => {
  const stubHandler = vi.fn(async () => ({ text: 'ok' }));

  it('fills defaults for optional fields', () => {
    const config: AgentClientConfig = {
      handler: stubHandler,
    } as unknown as AgentClientConfig;

    const resolved = resolveAgentClientConfig(config);

    expect(resolved.id).toBe('main');
    expect(resolved.tools).toEqual([]);
    expect(resolved.toolSets).toEqual([]);
    expect(resolved.maxAgentTurns).toBe(0);
    expect(resolved.enableAttachments).toBe(true);
    expect(resolved.handlerThrottleMs).toBe(1000);
  });

  it('preserves explicitly provided values', () => {
    const config: AgentClientConfig = {
      id: 'custom-id',
      handler: stubHandler,
      tools: [{ name: 'echo', description: 'Echo', parameters: {} as any, execute: async () => {} }],
      toolSets: [{ name: 'test', tools: [] }],
      maxAgentTurns: 5,
      enableAttachments: false,
      handlerThrottleMs: 500,
    } as unknown as AgentClientConfig;

    const resolved = resolveAgentClientConfig(config);

    expect(resolved.id).toBe('custom-id');
    expect(resolved.tools).toHaveLength(1);
    expect(resolved.toolSets).toHaveLength(1);
    expect(resolved.maxAgentTurns).toBe(5);
    expect(resolved.enableAttachments).toBe(false);
    expect(resolved.handlerThrottleMs).toBe(500);
  });

  it('wraps handler with throttling', async () => {
    const config: AgentClientConfig = {
      handler: stubHandler,
      handlerThrottleMs: 0,
    } as unknown as AgentClientConfig;

    const resolved = resolveAgentClientConfig(config);

    // The wrapped handler should still work
    const result = await resolved.handler(
      [{ role: 'user', content: 'hi' }],
      { tools: [], callTool: vi.fn() as any, toolChoice: 'auto', signal: new AbortController().signal },
    );
    expect(result).toEqual({ text: 'ok' });
  });
});
