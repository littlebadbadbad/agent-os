import { describe, it, expect, vi } from 'vitest';
import { createTerminalToolSet } from '../../tools/terminal/toolSet';
import { resolveToolSetTools, MAIN_CONVERSATION_ID } from '../../tools/toolSet';
import type { TerminalManagerAdapter } from '../../tools/terminal';

function makeTsCtx(sessionId = 'session-1') {
  return { sessionId, agentName: 'main', conversationId: MAIN_CONVERSATION_ID };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTerminalAdapter(): TerminalManagerAdapter {
  return {
    listTerminals:  vi.fn().mockResolvedValue([]),
    listShells:     vi.fn().mockResolvedValue([]),
    createTerminal: vi.fn(),
    removeTerminal: vi.fn().mockResolvedValue(undefined),
    sendInput:      vi.fn().mockResolvedValue(undefined),
    readOutput:     vi.fn().mockResolvedValue({ output: '', offset: 0, running: true }),
    streamOutput:   vi.fn().mockReturnValue(() => {}),
    resizePty:      vi.fn().mockResolvedValue(undefined),
  };
}

// ── createTerminalToolSet ─────────────────────────────────────────────────────

describe('createTerminalToolSet', () => {
  it('returns a ToolSet with name "terminal"', () => {
    const ts = createTerminalToolSet(makeTerminalAdapter());
    expect(ts.name).toBe('terminal');
  });

  it('exposes the adapter via .adapter property', () => {
    const adapter = makeTerminalAdapter();
    const ts = createTerminalToolSet(adapter);
    expect(ts.adapter).toBe(adapter);
  });

  it('tools is an array (eager form)', () => {
    const ts = createTerminalToolSet(makeTerminalAdapter());
    expect(Array.isArray(ts.tools)).toBe(true);
  });

  it('resolving tools() returns the 7 terminal tools', () => {
    const ts = createTerminalToolSet(makeTerminalAdapter());
    const names = resolveToolSetTools(ts).map((t) => t.name);
    expect(names).toContain('terminal_list');
    expect(names).toContain('terminal_create');
    expect(names).toContain('terminal_read');
    expect(names).toContain('terminal_send');
    expect(names).toContain('terminal_remove');
    expect(names).toContain('terminal_sleep');
    expect(names).toContain('terminal_wait');
    expect(names).toHaveLength(7);
  });

  it('onGetState returns { terminalAdapter: adapter }', () => {
    const adapter = makeTerminalAdapter();
    const ts = createTerminalToolSet(adapter);
    expect(ts.onGetState?.(makeTsCtx('session-1'))).toEqual({ terminalAdapter: adapter });
  });

  it('does not implement onInitSession, onResetSession, or onBuildSnapshot', () => {
    const ts = createTerminalToolSet(makeTerminalAdapter());
    expect(ts.onInitSession).toBeUndefined();
    expect(ts.onResetSession).toBeUndefined();
    expect(ts.onBuildSnapshot).toBeUndefined();
  });
});
