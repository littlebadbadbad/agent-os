import { describe, it, expect, vi } from 'vitest';

const mockLoadSessions = vi.fn();
const mockSaveSessions = vi.fn();

vi.mock('../api/backend', () => ({
  loadSessions: (...a: unknown[]) => mockLoadSessions(...a),
  saveSessions: (...a: unknown[]) => mockSaveSessions(...a),
}));

import { createSessionStore, sessionStore } from '../createAdapters';

describe('createSessionStore', () => {
  it('returns a SessionStore with loadSessions and saveSessions', () => {
    const store = createSessionStore();
    expect(store).toHaveProperty('loadSessions');
    expect(store).toHaveProperty('saveSessions');
    expect(typeof store.loadSessions).toBe('function');
    expect(typeof store.saveSessions).toBe('function');
  });

  it('loadSessions delegates to backend.loadSessions', async () => {
    const expected = [{ sessionId: 's1' }];
    mockLoadSessions.mockResolvedValue(expected);
    const store = createSessionStore();
    const result = await store.loadSessions('agent-1');
    expect(mockLoadSessions).toHaveBeenCalledWith('agent-1');
    expect(result).toBe(expected);
  });

  it('saveSessions delegates to backend.saveSessions', async () => {
    const sessions = [{ id: 's1', title: 's1', sessionId: 's1' }];
    mockSaveSessions.mockResolvedValue(undefined);
    const store = createSessionStore();
    await store.saveSessions('agent-1', sessions);
    expect(mockSaveSessions).toHaveBeenCalledWith('agent-1', sessions);
  });
});

describe('sessionStore singleton', () => {
  it('is a SessionStore instance', () => {
    expect(sessionStore).toHaveProperty('loadSessions');
    expect(sessionStore).toHaveProperty('saveSessions');
  });
});
