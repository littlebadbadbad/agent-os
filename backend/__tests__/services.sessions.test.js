/**
 * Tests for backend/services/sessions.js — Session persistence service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoadSessions = vi.fn();
const mockSaveSessions = vi.fn();

vi.mock('../lib/sessions.js', () => ({
  AGENT_ID_RE: /^[a-zA-Z0-9_-]{1,64}$/,
  loadSessions: mockLoadSessions,
  saveSessions: mockSaveSessions,
}));

describe('sessions service', () => {
  let sessions;

  beforeEach(async () => {
    vi.resetModules();
    sessions = await import('../services/sessions.js');
  });

  it('loadAgentSessions loads and returns sessions', () => {
    mockLoadSessions.mockReturnValue([{ id: 's1' }]);
    const result = sessions.loadAgentSessions({ agentId: 'test-agent' });
    expect(result.sessions).toEqual([{ id: 's1' }]);
    expect(mockLoadSessions).toHaveBeenCalledWith('test-agent');
  });

  it('loadAgentSessions throws for missing agentId', () => {
    expect(() => sessions.loadAgentSessions({})).toThrow('agentId is required');
  });

  it('loadAgentSessions throws for invalid agentId', () => {
    expect(() => sessions.loadAgentSessions({ agentId: '../bad' })).toThrow('Invalid agentId');
  });

  it('saveAgentSessions saves and returns ok', () => {
    const result = sessions.saveAgentSessions({ agentId: 'valid', sessions: [{ id: 's1' }] });
    expect(result).toEqual({ ok: true });
    expect(mockSaveSessions).toHaveBeenCalledWith('valid', [{ id: 's1' }]);
  });

  it('saveAgentSessions throws for missing agentId', () => {
    expect(() => sessions.saveAgentSessions({ sessions: [] })).toThrow('agentId is required');
  });

  it('saveAgentSessions throws for non-array sessions', () => {
    expect(() => sessions.saveAgentSessions({ agentId: 'ok', sessions: 'not-array' })).toThrow('sessions must be an array');
  });
});
