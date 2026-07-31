import { describe, it, expect, vi } from 'vitest';
import { createTerminalToolSet } from '../../agent/shell';
import { resolveToolSetTools } from '@agent-type';
import type { TerminalManagerAdapter } from '../../agent/shell';

// ── Fixtures ─────────────────────────────────────────────────────────────────

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
    waitTerminal:   vi.fn().mockResolvedValue({
      output: '', offset: 0, running: false, exitCode: 0,
      timedOut: false, reason: 'exited',
    }),
    cancelWait:     vi.fn().mockResolvedValue(undefined),
    sleepTerminal:  vi.fn().mockResolvedValue({ slept: 100, aborted: false }),
  };
}

// ── createTerminalToolSet ────────────────────────────────────────────────────

describe('createTerminalToolSet', () => {
  it('returns a ToolSet with name "terminal"', () => {
    const ts = createTerminalToolSet(makeTerminalAdapter());
    expect(ts.name).toBe('terminal');
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
    expect(names).toContain('terminal_wait');
    expect(names).toHaveLength(6);
  });

  it('does not expose onGetSymbolState (UI creates its own adapter)', () => {
    const ts = createTerminalToolSet(makeTerminalAdapter());
    expect(ts.onGetSymbolState).toBeUndefined();
  });

  it('does not implement onInit, onReset, or onBuildSnapshot', () => {
    const ts = createTerminalToolSet(makeTerminalAdapter());
    expect(ts.onInit).toBeUndefined();
    expect(ts.onReset).toBeUndefined();
    expect(ts.onBuildSnapshot).toBeUndefined();
  });
});
