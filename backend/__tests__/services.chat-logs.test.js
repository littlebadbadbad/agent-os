/**
 * Tests for backend/services/chat-logs.js — Chat audit log service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListLogs = vi.fn();
const mockGetLog = vi.fn();
const mockGetStats = vi.fn();

vi.mock('../lib/chat-log.js', () => ({
  listLogs: mockListLogs,
  getLog: mockGetLog,
  getStats: mockGetStats,
}));

describe('chat-logs service', () => {
  let chatLogs;

  beforeEach(async () => {
    vi.resetModules();
    chatLogs = await import('../services/chat-logs.js');
  });

  it('queryLogs calls listLogs with normalized params', () => {
    mockListLogs.mockReturnValue({ total: 0, logs: [] });
    const result = chatLogs.queryLogs({ limit: '20', offset: '0' });
    expect(result.total).toBe(0);
    expect(mockListLogs).toHaveBeenCalled();
  });

  it('queryLogs calls listLogs with no params uses defaults', () => {
    mockListLogs.mockReturnValue({ total: 0, logs: [] });
    chatLogs.queryLogs();
    expect(mockListLogs).toHaveBeenCalledWith({
      limit: 50, offset: 0,
      provider: undefined, mode: undefined,
      startTime: undefined, endTime: undefined,
    });
  });

  it('fetchLog returns log entry for id', () => {
    mockGetLog.mockReturnValue({ id: 'abc' });
    const entry = chatLogs.fetchLog('abc');
    expect(entry.id).toBe('abc');
    expect(mockGetLog).toHaveBeenCalledWith('abc');
  });

  it('fetchLog returns null for unknown id', () => {
    mockGetLog.mockReturnValue(undefined);
    expect(chatLogs.fetchLog('unknown')).toBeNull();
  });

  it('fetchStats returns stats', () => {
    mockGetStats.mockReturnValue({ total: 10, byProvider: [], byMode: [] });
    const stats = chatLogs.fetchStats();
    expect(stats.total).toBe(10);
  });
});
