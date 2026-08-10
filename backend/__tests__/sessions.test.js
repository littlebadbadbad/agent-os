/**
 * Tests for backend/lib/sessions.js — Session file persistence.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock paths.js to point to a temp directory
const TEST_DATA_ROOT = join(tmpdir(), `uap-test-sessions-${Date.now()}`);
vi.mock('../lib/paths.js', () => ({
  DATA_ROOT: TEST_DATA_ROOT,
}));

// Re-import after mocking
const { AGENT_ID_RE, loadSessions, saveSessions } = await import('../lib/sessions.js');

describe('AGENT_ID_RE', () => {
  it('matches valid agent IDs', () => {
    expect(AGENT_ID_RE.test('stream-agent')).toBe(true);
    expect(AGENT_ID_RE.test('agent_123')).toBe(true);
    expect(AGENT_ID_RE.test('AGENT-42')).toBe(true);
  });

  it('rejects invalid agent IDs', () => {
    expect(AGENT_ID_RE.test('')).toBe(false);
    expect(AGENT_ID_RE.test('../etc/passwd')).toBe(false);
    expect(AGENT_ID_RE.test('a/b')).toBe(false);
    expect(AGENT_ID_RE.test('a'.repeat(65))).toBe(false);
  });
});

describe('loadSessions / saveSessions', () => {
  const agentId = 'test-agent';

  beforeEach(() => {
    // Ensure temp dir exists
    if (!existsSync(TEST_DATA_ROOT)) {
      mkdirSync(TEST_DATA_ROOT, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temp files
    try {
      const target = join(TEST_DATA_ROOT, `sessions-${agentId}.json`);
      const tmp = target + '.tmp';
      if (existsSync(target)) unlinkSync(target);
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch { /* ignore */ }
  });

  afterAll(() => {
    // Clean up temp dir
    try { rmSync(TEST_DATA_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('loadSessions returns empty array when no file exists', () => {
    const result = loadSessions(agentId);
    expect(result).toEqual([]);
  });

  it('saveSessions and loadSessions round-trip', () => {
    const sessions = [{ id: 's1', title: 'Session 1', messages: [] }];
    saveSessions(agentId, sessions);
    const loaded = loadSessions(agentId);
    expect(loaded).toEqual(sessions);
  });

  it('saveSessions overwrites previous data', () => {
    saveSessions(agentId, [{ id: 'old' }]);
    saveSessions(agentId, [{ id: 'new' }]);
    const loaded = loadSessions(agentId);
    expect(loaded).toEqual([{ id: 'new' }]);
  });

  it('loadSessions throws for invalid agentId', () => {
    expect(() => loadSessions('../malicious')).toThrow('Invalid agentId');
  });

  it('saveSessions throws for invalid agentId', () => {
    expect(() => saveSessions('../../malicious', [])).toThrow('Invalid agentId');
  });
});
