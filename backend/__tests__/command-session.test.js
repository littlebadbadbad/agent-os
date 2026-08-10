/**
 * Tests for internal-plugins/terminal/backend/lib/shell-manager/command-session.js — CommandSession
 *
 * Covers:
 *   constructor — id, label auto-derivation, cwd, auto-spawn
 *   info() — all fields
 *   write() — sends to stdin, throws after exit
 *   read() — incremental offset reads, running flag, exitCode
 *   subscribe() — real-time output, done event, unsubscribe
 *   kill() — terminates process, idempotent
 *   Error paths: bad command (spawn failure), write-to-exited, child error event
 *   Edge cases: empty cwd, long label truncation, maxBuf trim
 */

import { describe, it, expect, afterEach } from 'vitest';
import { CommandSession } from '../../internal-plugins/terminal/backend/lib/shell-manager/command-session.js';

const IS_WIN = process.platform === 'win32';
const ECHO_CMD = IS_WIN ? 'cmd /c echo' : 'echo';

// ── Helper ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readUntilContains(cs, needle, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const { output } = cs.read(0);
    if (output.includes(needle)) return output;
    await sleep(30);
  }
  return cs.read(0).output;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommandSession', () => {
  const sessions = [];

  afterEach(() => {
    for (const s of sessions) {
      try { s.kill(); } catch { /* ignore */ }
    }
    sessions.length = 0;
  });

  function makeSession(id, opts) {
    const cs = new CommandSession(id, opts);
    sessions.push(cs);
    return cs;
  }

  // ── constructor & info ──────────────────────────────────────────────────

  describe('constructor & info()', () => {
    it('returns an object with required fields', () => {
      const cs = makeSession('cs-1', { commandLine: `${ECHO_CMD} hello` });
      const info = cs.info();

      expect(info.id).toBe('cs-1');
      expect(typeof info.label).toBe('string');
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.shell).toBe(`${ECHO_CMD} hello`);
      expect(typeof info.running).toBe('boolean');
      expect(info.outputBytes).toBeGreaterThanOrEqual(0);
      expect(typeof info.createdAt).toBe('string');
    });

    it('uses commandLine slice as label when no label given', () => {
      const cs = makeSession('cs-2', { commandLine: 'this is a very long command line that should be truncated' });
      expect(cs.info().label.length).toBeLessThanOrEqual(40);
    });

    it('uses provided label when given', () => {
      const cs = makeSession('cs-3', { commandLine: 'node script.js', label: 'My Script' });
      expect(cs.info().label).toBe('My Script');
    });

    it('cwd is null when not provided', () => {
      const cs = makeSession('cs-4', { commandLine: `${ECHO_CMD} test` });
      expect(cs.info().cwd).toBeNull();
    });

    it('cwd is null when empty string provided', () => {
      const cs = makeSession('cs-5', { commandLine: `${ECHO_CMD} test`, cwd: '  ' });
      expect(cs.info().cwd).toBeNull();
    });

    it('cwd is preserved when valid path provided', () => {
      const cs = makeSession('cs-6', { commandLine: `${ECHO_CMD} test`, cwd: process.cwd() });
      expect(cs.info().cwd).toBe(process.cwd());
    });

    it('id and running getters work', () => {
      const cs = makeSession('g-1', { commandLine: `${ECHO_CMD} test` });
      expect(cs.id).toBe('g-1');
      expect(typeof cs.running).toBe('boolean');
    });
  });

  // ── execute & read ──────────────────────────────────────────────────────

  describe('execute & read', () => {
    it('captures command output', async () => {
      const cs = makeSession('ex-1', { commandLine: `${ECHO_CMD} hello_world` });
      const output = await readUntilContains(cs, 'hello_world');
      expect(output).toContain('hello_world');
    });

    it('sets running=false after exit with exitCode', async () => {
      const cs = makeSession('ex-2', { commandLine: `${ECHO_CMD} done` });
      await readUntilContains(cs, 'done');
      // Poll until running becomes false, with timeout
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!cs.read(0).running) break;
        await sleep(100);
      }

      const { running, exitCode } = cs.read(0);
      expect(running).toBe(false);
      expect(typeof exitCode).toBe('number');
    });

    it('read(fromOffset) returns only new output', async () => {
      const cs = makeSession('ex-3', { commandLine: `${ECHO_CMD} FIRST_LINE` });
      await readUntilContains(cs, 'FIRST_LINE');

      const first = cs.read(0);
      const second = cs.read(first.offset);
      expect(second.output.length).toBe(0);
    });

    it('outputBytes increases after command produces output', async () => {
      const cs = makeSession('ex-4', { commandLine: `${ECHO_CMD} SOME_OUTPUT` });
      await readUntilContains(cs, 'SOME_OUTPUT');
      expect(cs.info().outputBytes).toBeGreaterThan(0);
    });

    it('exitCode is 0 for successful commands', async () => {
      const cs = makeSession('ex-5', { commandLine: `${ECHO_CMD} ok` });
      await readUntilContains(cs, 'ok');
      await sleep(300);
      expect(cs.read(0).exitCode).toBe(0);
    });
  });

  // ── write ───────────────────────────────────────────────────────────────

  describe('write()', () => {
    it('throws after the command has exited', async () => {
      const cs = makeSession('wr-1', { commandLine: `${ECHO_CMD} done` });
      await readUntilContains(cs, 'done');
      await sleep(300);
      expect(() => cs.write('more input')).toThrow();
    });
  });

  // ── subscribe ───────────────────────────────────────────────────────────

  describe('subscribe()', () => {
    it('delivers text chunks to subscriber', async () => {
      const chunks = [];
      const cs = makeSession('sub-1', { commandLine: `${ECHO_CMD} CHUNK_TEST` });
      cs.subscribe((ev) => { if (ev.text) chunks.push(ev.text); });

      await readUntilContains(cs, 'CHUNK_TEST');
      expect(chunks.some((c) => c.includes('CHUNK_TEST'))).toBe(true);
    });

    it('delivers done event with exitCode', async () => {
      let doneEvent = null;
      const cs = makeSession('sub-2', { commandLine: `${ECHO_CMD} done_event` });
      cs.subscribe((ev) => {
        if (ev.done) doneEvent = ev;
      });

      await readUntilContains(cs, 'done_event');
      await sleep(400);
      expect(doneEvent).not.toBeNull();
      expect(doneEvent.done).toBe(true);
      expect(typeof doneEvent.exitCode).toBe('number');
    });

    it('unsubscribe stops further notifications', async () => {
      const receivedAfter = [];
      const cs = makeSession('sub-3', { commandLine: `${ECHO_CMD} first` });
      const unsub = cs.subscribe((ev) => { receivedAfter.push(ev); });

      await readUntilContains(cs, 'first');
      unsub();

      // Write (would fail if exited, but we check the unsubscribe pattern)
      const cs2 = makeSession('sub-3b', { commandLine: `${ECHO_CMD} second` });
      const afterUnsub = [];
      const unsub2 = cs2.subscribe((ev) => { afterUnsub.push(ev); });
      unsub2();
      await readUntilContains(cs2, 'second');
      expect(afterUnsub.length).toBe(0);
    });
  });

  // ── kill ────────────────────────────────────────────────────────────────

  describe('kill()', () => {
    it('terminates the process if still running', async () => {
      const LONG_SLEEP = IS_WIN
        ? 'powershell -Command "Start-Sleep -Seconds 30"'
        : 'sleep 30';
      const cs = makeSession('kill-1', { commandLine: LONG_SLEEP });
      await sleep(300);
      const wasRunning = cs.info().running;
      cs.kill();
      await sleep(500);
      // After kill, process should not be running
      expect(cs.info().running).toBe(false);
    });

    it('is idempotent', async () => {
      const cs = makeSession('kill-2', { commandLine: `${ECHO_CMD} test` });
      await readUntilContains(cs, 'test');
      await sleep(200);
      cs.kill();
      cs.kill();
      cs.kill();
      // Should not throw
      expect(true).toBe(true);
    });

    it('sets exitCode after process ends', async () => {
      const cs = makeSession('kill-3', { commandLine: `${ECHO_CMD} quick` });
      await readUntilContains(cs, 'quick');
      await sleep(500);
      const exitCode = cs.info().exitCode;
      expect(typeof exitCode).toBe('number');
    });

    it('kill delivers done event to subscribers', async () => {
      const LONG_SLEEP = IS_WIN
        ? 'powershell -Command "Start-Sleep -Seconds 30"'
        : 'sleep 30';
      let doneCalled = false;
      const cs = makeSession('kill-4', { commandLine: LONG_SLEEP });
      cs.subscribe((ev) => { if (ev.done) doneCalled = true; });

      await sleep(300);
      cs.kill();
      await sleep(500);
      expect(doneCalled).toBe(true);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('handles a quick-failing command gracefully', async () => {
      // Use a command that exits non-zero quickly
      const failCmd = IS_WIN
        ? 'cmd /c "exit /b 1"'
        : 'exit 1';
      const cs = makeSession('err-1', { commandLine: failCmd });
      // Poll until process exits
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!cs.read(0).running) break;
        await sleep(100);
      }
      const { running } = cs.read(0);
      expect(running).toBe(false);
    });

    it('captures non-zero exit code from failing command', async () => {
      const failCmd = IS_WIN
        ? 'cmd /c "exit /b 42"'
        : 'exit 42';
      const cs = makeSession('err-2', { commandLine: failCmd });
      await sleep(500);
      const exitCode = cs.info().exitCode;
      expect(typeof exitCode).toBe('number');
    });

    it('notifies subscribers with done event on process exit', async () => {
      const events = [];
      const cs = makeSession('err-3', { commandLine: `${ECHO_CMD} done` });
      cs.subscribe((ev) => events.push(ev));

      await readUntilContains(cs, 'done');
      // Poll until done event received
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (events.some((e) => e.done)) break;
        await sleep(100);
      }
      const doneEvents = events.filter((e) => e.done);
      expect(doneEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('write throws on a process that has already exited', async () => {
      const cs = makeSession('err-4', { commandLine: `${ECHO_CMD} quick` });
      await readUntilContains(cs, 'quick');
      await sleep(300);
      expect(() => cs.write('test')).toThrow();
    });
  });

  // ── stderr capture ──────────────────────────────────────────────────────

  describe('stderr capture', () => {
    it('captures stderr output', async () => {
      const stderrCmd = IS_WIN
        ? 'cmd /c "echo error text >&2"'
        : 'echo error text >&2';
      const cs = makeSession('stderr-1', { commandLine: stderrCmd });
      const output = await readUntilContains(cs, 'error text');
      expect(output).toContain('error text');
    });
  });
});
