/**
 * extensions/terminal/__tests__/backend/terminals.test.js
 *
 * Integration tests for the interactive-terminal subsystem.
 *
 * Exercises shell-manager.js (TerminalInstance + module exports) end-to-end
 * with real shell processes — no child_process mocks.
 *
 * Covers:
 *   listAvailableShells    — structure, Windows/Unix invariants
 *   createTerminal         — id format, info() fields, label, cwd
 *   getTerminal            — lookup by id, missing id
 *   listTerminalEntries    — includes created terminals
 *   removeTerminal         — removes from registry, unknown id
 *   writeToTerminal        — runs commands, captures output, incremental offset
 *   streamTerminalOutput   — receives chunks, done event, abort signal
 *   error handling         — bad shell ENOENT recovery, write-to-dead-terminal
 *
 * Moved from backend/__tests__/terminals.test.js — belongs in the app.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createTerminal,
  getTerminal,
  listTerminalEntries,
  removeTerminal,
  writeToTerminal,
  resizeTerminal,
  streamTerminalOutput,
  listAvailableShells,
} from '../../backend/lib/shell-manager/index.js';

const IS_WIN = process.platform === 'win32';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForOutput(id, needle, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const term = getTerminal(id);
    if (!term) throw new Error(`Terminal "${id}" was removed while waiting`);
    const { output } = term.read(0);
    const hit = typeof needle === 'string' ? output.includes(needle) : needle.test(output);
    if (hit) return output;
    await sleep(50);
  }
  const { output } = getTerminal(id)?.read(0) ?? { output: '' };
  throw new Error(
    `waitForOutput: timed out after ${timeoutMs} ms.\n` +
    `Looking for: ${needle}\n` +
    `Buffer tail: ${JSON.stringify(output.slice(-400))}`,
  );
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

const _created = [];

afterEach(() => {
  for (const id of _created.splice(0)) {
    try { removeTerminal(id); } catch { /* already removed */ }
  }
});

function track(id) { _created.push(id); return id; }

// ─── listAvailableShells ──────────────────────────────────────────────────────

describe('listAvailableShells', () => {
  it('returns a non-empty array', () => {
    const shells = listAvailableShells();
    expect(Array.isArray(shells)).toBe(true);
    expect(shells.length).toBeGreaterThan(0);
  });

  it('every entry has name (string), path (string), isDefault (boolean)', () => {
    for (const s of listAvailableShells()) {
      expect(typeof s.name).toBe('string');
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.path).toBe('string');
      expect(s.path.length).toBeGreaterThan(0);
      expect(typeof s.isDefault).toBe('boolean');
    }
  });

  it('exactly one shell is marked isDefault', () => {
    const defaults = listAvailableShells().filter((s) => s.isDefault);
    expect(defaults.length).toBe(1);
  });

  if (IS_WIN) {
    it('includes cmd.exe on Windows', () => {
      expect(listAvailableShells().some((s) => s.name === 'cmd.exe')).toBe(true);
    });
  } else {
    it('includes bash or sh on Unix', () => {
      expect(
        listAvailableShells().some((s) => s.name === 'bash' || s.name === 'sh'),
      ).toBe(true);
    });
  }
});

// ─── createTerminal ───────────────────────────────────────────────────────────

describe('createTerminal', () => {
  it('returns an object with a term_* id and running=true', () => {
    const term = createTerminal({});
    track(term.id);
    expect(term.id).toMatch(/^term_[0-9a-f]+$/);
    expect(term.running).toBe(true);
  });

  it('info() returns all required fields with correct types', () => {
    const term = createTerminal({ label: 'info-test' });
    track(term.id);
    const info = term.info();
    expect(info.id).toBe(term.id);
    expect(info.label).toBe('info-test');
    expect(typeof info.shell).toBe('string');
    expect(info.shell.length).toBeGreaterThan(0);
    expect(info.running).toBe(true);
    expect(typeof info.createdAt).toBe('string');
    expect(typeof info.outputBytes).toBe('number');
    expect(info.cwd).toBeNull();
  });

  it('uses provided label', () => {
    const term = createTerminal({ label: 'custom-label' });
    track(term.id);
    expect(term.info().label).toBe('custom-label');
  });

  it('records cwd when provided', () => {
    const cwd = IS_WIN ? 'C:\\Windows\\Temp' : '/tmp';
    const term = createTerminal({ cwd });
    track(term.id);
    expect(term.info().cwd).toBe(cwd);
  });

  it('two terminals have distinct ids', () => {
    const a = createTerminal({});
    const b = createTerminal({});
    track(a.id); track(b.id);
    expect(a.id).not.toBe(b.id);
  });
});

// ─── getTerminal ──────────────────────────────────────────────────────────────

describe('getTerminal', () => {
  it('finds a terminal by id', () => {
    const term = createTerminal({});
    track(term.id);
    const found = getTerminal(term.id);
    expect(found).not.toBeNull();
    expect(found.id).toBe(term.id);
  });

  it('returns null for an unknown id', () => {
    expect(getTerminal('no_such_id_xyz')).toBeNull();
  });
});

// ─── listTerminalEntries ──────────────────────────────────────────────────────

describe('listTerminalEntries', () => {
  it('includes newly created terminals', () => {
    const term = createTerminal({ label: 'listed' });
    track(term.id);
    expect(listTerminalEntries().some((e) => e.id === term.id)).toBe(true);
  });

  it('entry fields match info()', () => {
    const term = createTerminal({ label: 'entry-check' });
    track(term.id);
    const entry = listTerminalEntries().find((e) => e.id === term.id);
    expect(entry).toBeDefined();
    expect(entry.label).toBe('entry-check');
    expect(entry.running).toBe(true);
  });

  it('does NOT include removed terminals', () => {
    const term = createTerminal({});
    removeTerminal(term.id);
    expect(listTerminalEntries().some((e) => e.id === term.id)).toBe(false);
  });
});

// ─── removeTerminal ───────────────────────────────────────────────────────────

describe('removeTerminal', () => {
  it('returns true and removes terminal from registry', () => {
    const term = createTerminal({});
    expect(removeTerminal(term.id)).toBe(true);
    expect(getTerminal(term.id)).toBeNull();
  });

  it('returns false for unknown id', () => {
    expect(removeTerminal('does_not_exist_xyz')).toBe(false);
  });

  it('is safe to call after shell has already exited', async () => {
    const term = createTerminal({});
    track(term.id);
    writeToTerminal(term.id, 'exit\n');
    await sleep(600);
    expect(() => removeTerminal(term.id)).not.toThrow();
  }, 8000);
});

// ─── writeToTerminal + read() ─────────────────────────────────────────────────

describe('writeToTerminal + read', () => {
  it('executes a command and output appears in read()', async () => {
    const term = createTerminal({});
    track(term.id);
    writeToTerminal(term.id, 'echo hello_world\n');
    await waitForOutput(term.id, 'hello_world');
    expect(getTerminal(term.id).read(0).output).toContain('hello_world');
  }, 10000);

  it('outputBytes increases after a command produces output', async () => {
    const term = createTerminal({});
    track(term.id);
    const before = term.info().outputBytes;
    writeToTerminal(term.id, 'echo byte_count_test\n');
    await waitForOutput(term.id, 'byte_count_test');
    expect(term.info().outputBytes).toBeGreaterThan(before);
  }, 10000);

  it('incremental read (fromOffset) returns only new output', async () => {
    const term = createTerminal({});
    track(term.id);
    writeToTerminal(term.id, 'echo first_marker\n');
    await waitForOutput(term.id, 'first_marker');
    const snap1 = getTerminal(term.id).read(0);
    expect(snap1.output).toContain('first_marker');
    const offset1 = snap1.offset;
    writeToTerminal(term.id, 'echo second_marker\n');
    await waitForOutput(term.id, 'second_marker');
    const snap2 = getTerminal(term.id).read(offset1);
    expect(snap2.output).toContain('second_marker');
    expect(snap2.output).not.toContain('first_marker');
  }, 12000);

  it('read() reflects running=false after shell exits', async () => {
    const term = createTerminal({});
    track(term.id);
    writeToTerminal(term.id, 'exit\n');
    const deadline = Date.now() + 5000;
    while (getTerminal(term.id).running && Date.now() < deadline) await sleep(50);
    expect(getTerminal(term.id).read(0).running).toBe(false);
  }, 10000);

  it('throws for a non-existent terminal id', () => {
    expect(() => writeToTerminal('no_such_terminal', 'hello\n')).toThrow(/not found/i);
  });

  it('executes a command sent with bare \\n (no \\r) on all platforms', async () => {
    const term = createTerminal({});
    track(term.id);
    writeToTerminal(term.id, 'echo lf_only_marker\n');
    await waitForOutput(term.id, 'lf_only_marker');
    expect(getTerminal(term.id).read(0).output).toContain('lf_only_marker');
  }, 10000);

  it('throws when the terminal has already exited', async () => {
    const term = createTerminal({});
    track(term.id);
    writeToTerminal(term.id, 'exit\n');
    const deadline = Date.now() + 5000;
    while (getTerminal(term.id).running && Date.now() < deadline) await sleep(50);
    expect(() => writeToTerminal(term.id, 'something\n')).toThrow(/exited/i);
  }, 10000);
});

// ─── streamTerminalOutput ─────────────────────────────────────────────────────

describe('streamTerminalOutput', () => {
  it('delivers output text chunks to the subscriber', async () => {
    const term = createTerminal({});
    track(term.id);
    const received = [];
    const ctrl = new AbortController();
    streamTerminalOutput(term.id, ({ text }) => { if (text) received.push(text); }, ctrl.signal);
    writeToTerminal(term.id, 'echo streamed_text\n');
    await waitForOutput(term.id, 'streamed_text');
    ctrl.abort();
    expect(received.join('')).toContain('streamed_text');
  }, 10000);

  it('delivers a done event with exitCode=0 on clean shell exit', async () => {
    const term = createTerminal({});
    track(term.id);
    let doneEvent = null;
    streamTerminalOutput(term.id, (ev) => { if (ev.done) doneEvent = ev; });
    writeToTerminal(term.id, 'exit\n');
    const deadline = Date.now() + 5000;
    while (!doneEvent && Date.now() < deadline) await sleep(50);
    expect(doneEvent).not.toBeNull();
    expect(doneEvent.exitCode).toBe(0);
    expect(getTerminal(term.id).running).toBe(false);
  }, 10000);

  it('stops delivering after the signal is aborted', async () => {
    const term = createTerminal({});
    track(term.id);
    const ctrl = new AbortController();
    const calls = [];
    streamTerminalOutput(term.id, (ev) => calls.push(ev), ctrl.signal);
    ctrl.abort();
    const countAfterAbort = calls.length;
    try { writeToTerminal(term.id, 'echo should_not_arrive\n'); } catch { /* */ }
    await sleep(300);
    expect(calls.length).toBe(countAfterAbort);
  }, 6000);

  it('throws for a non-existent terminal id', () => {
    expect(() => streamTerminalOutput('no_such', () => {})).toThrow(/not found/i);
  });
});

// ─── ENOENT recovery ─────────────────────────────────────────────────────────

describe('error handling — bad shell name (ENOENT)', () => {
  it('does not crash the process; terminal shows error in buffer', async () => {
    const term = createTerminal({ shell: 'definitely_nonexistent_shell_xyz_abc' });
    track(term.id);
    await sleep(400);
    expect(term.running).toBe(false);
    expect(term.read(0).output).toContain('[terminal error:');
    expect(term.info().exitCode).toBe(-1);
  }, 6000);

  it('notifies subscribers with error text then done event', async () => {
    const term = createTerminal({ shell: 'definitely_nonexistent_shell_xyz_abc' });
    track(term.id);
    const events = [];
    streamTerminalOutput(term.id, (ev) => events.push(ev));
    await sleep(400);
    const textEvents = events.filter((e) => !e.done && e.text);
    const doneEvent  = events.find((e) => e.done);
    expect(textEvents.some((e) => e.text.includes('[terminal error:'))).toBe(true);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.exitCode).toBe(-1);
  }, 6000);

  it('writeToTerminal throws on a terminal that never started', async () => {
    const term = createTerminal({ shell: 'definitely_nonexistent_shell_xyz_abc' });
    track(term.id);
    await sleep(400);
    expect(() => writeToTerminal(term.id, 'hello\n')).toThrow(/exited/i);
  }, 6000);
});
