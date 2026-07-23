/**
 * Tests for backend/lib/chat-log.js — SQLite-backed chat audit log.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock better-sqlite3 — must be a constructor since chat-log.js does `new Database(...)`
const mockRun = vi.fn();
const mockGet = vi.fn();
const mockAll = vi.fn();
const mockPrepare = vi.fn(() => ({ run: mockRun, get: mockGet, all: mockAll }));
const MockDatabase = vi.fn(function MockDb() {
  this.prepare = mockPrepare;
  this.pragma = vi.fn();
  this.exec = vi.fn();
});

vi.mock('better-sqlite3', () => ({ default: MockDatabase }));

vi.mock('../lib/paths.js', () => ({
  DATA_ROOT: '/tmp/test-data',
  SQLITE_BINDING: undefined,
}));

describe('chat-log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue({ total: 0 });
    mockAll.mockReturnValue([]);
  });

  it('exports logChat, listLogs, getLog, getStats', async () => {
    const mod = await import('../lib/chat-log.js');
    expect(typeof mod.logChat).toBe('function');
    expect(typeof mod.listLogs).toBe('function');
    expect(typeof mod.getLog).toBe('function');
    expect(typeof mod.getStats).toBe('function');
  });

  it('logChat inserts a record and returns an id', async () => {
    const { logChat } = await import('../lib/chat-log.js');
    const id = logChat({
      provider: 'openai',
      mode: 'async',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'get_weather' }],
      responseText: 'Hello!',
      durationMs: 150,
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(mockRun).toHaveBeenCalled();
  });

  it('logChat handles missing optional fields', async () => {
    const { logChat } = await import('../lib/chat-log.js');
    const id = logChat({ mode: 'stream', messages: [] });
    expect(id).toBeTruthy();
  });

  it('listLogs returns paginated results', async () => {
    const { listLogs } = await import('../lib/chat-log.js');
    mockGet.mockReturnValue({ total: 5 });
    mockAll.mockReturnValue([
      { id: '1', provider: 'openai', mode: 'async', message_count: 2, tool_count: 0, duration_ms: 100, error: null, created_at: '2024-01-01' },
    ]);
    const result = listLogs({ limit: 10, offset: 0 });
    expect(result.total).toBe(5);
    expect(result.logs).toHaveLength(1);
  });

  it('listLogs uses defaults when no params given', async () => {
    const { listLogs } = await import('../lib/chat-log.js');
    listLogs();
    expect(mockGet).toHaveBeenCalled();
  });

  it('getLog returns undefined for unknown id', async () => {
    const { getLog } = await import('../lib/chat-log.js');
    mockGet.mockReturnValue(undefined);
    expect(getLog('unknown')).toBeUndefined();
  });

  it('getLog returns parsed entry for known id', async () => {
    const { getLog } = await import('../lib/chat-log.js');
    mockGet.mockReturnValue({
      id: 'abc-123', provider: 'anthropic', mode: 'async',
      message_count: 3, tool_count: 1, tool_choice: 'auto',
      request_messages: '[{"role":"user"}]',
      system_prompt: null, response_text: 'Hello',
      response_tool_calls: '[{"id":"tc1"}]',
      error: null, duration_ms: 200, created_at: '2024-01-01',
    });
    const entry = getLog('abc-123');
    expect(entry.id).toBe('abc-123');
    expect(entry.messageCount).toBe(3);
    expect(entry.requestMessages).toEqual([{ role: 'user' }]);
  });

  it('getStats returns aggregated data', async () => {
    const { getStats } = await import('../lib/chat-log.js');
    mockAll
      .mockReturnValueOnce([{ provider: 'openai', count: 8 }])
      .mockReturnValueOnce([{ mode: 'async', count: 6 }]);
    const stats = getStats();
    expect(stats.total).toBeDefined();
    expect(stats.byProvider).toHaveLength(1);
    expect(stats.byMode).toHaveLength(1);
  });
});
