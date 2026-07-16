/**
 * Unit tests for snapshotBuilder.ts — the session snapshot builder.
 */

import { describe, it, expect, vi } from 'vitest';
import { createSnapshotBuilder } from '../../client/snapshotBuilder';
import type { ToolSet, ToolSetContext } from '@agent-type';

describe('createSnapshotBuilder', () => {
  const AGENT_ID = 'test-agent';

  function makeDeps() {
    const session = {
      getHistory: vi.fn(() => [{ role: 'user', content: 'hello' }]),
      getLiveHistory: vi.fn(() => [{ role: 'user', content: 'hello' }]),
    };

    const sessionMgr = {
      getState: vi.fn(() => ({
        sessions: [
          { id: 'sess-1', title: 'Test Chat', session },
        ],
      })),
    };

    const getAllToolSets = vi.fn(() => [] as ToolSet[]);

    return { deps: { sessionMgr: sessionMgr as any, agentId: AGENT_ID, getAllToolSets }, session };
  }

  it('builds a snapshot for an existing session', () => {
    const { deps } = makeDeps();
    const build = createSnapshotBuilder(deps);

    const snapshot = build('sess-1');

    expect(snapshot.id).toBe('sess-1');
    expect(snapshot.title).toBe('Test Chat');
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.liveHistory).toHaveLength(1);
  });

  it('includes ToolSet snapshot data from all toolSets', () => {
    const { deps } = makeDeps();
    deps.getAllToolSets = vi.fn(() => [
      { name: 'ts1', tools: [], onBuildSnapshot: () => ({ ts1Field: 'value1' }) },
    ] as ToolSet[]);

    const build = createSnapshotBuilder(deps);
    const snapshot = build('sess-1');

    expect((snapshot as any).ts1Field).toBe('value1');
  });

  it('throws for non-existent session', () => {
    const { deps } = makeDeps();
    const build = createSnapshotBuilder(deps);

    expect(() => build('nonexistent')).toThrow('not found');
  });
});
