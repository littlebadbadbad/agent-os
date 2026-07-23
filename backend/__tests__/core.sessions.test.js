/**
 * Tests for backend/core/sessions.js — super built-in "sessions" plugin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/sessions.js', () => ({
  loadAgentSessions: vi.fn(),
  saveAgentSessions: vi.fn(),
}));

import * as sessionService from '../services/sessions.js';

describe('core/sessions plugin', () => {
  let router;
  let register;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const mod = await import('../core/sessions.js');
    register = mod.register;
  });

  it('registers load and save methods', () => {
    register(router);
    expect(router.registerApi).toHaveBeenCalledWith('sessions', 'load', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('sessions', 'save', expect.any(Function));
  });

  it('load handler delegates to service', async () => {
    register(router);
    const h = findHandler('load');
    vi.mocked(sessionService.loadAgentSessions).mockResolvedValue({ sessions: [] });

    const result = await h({ agentId: 'test-agent' });

    expect(result).toEqual({ sessions: [] });
    expect(sessionService.loadAgentSessions).toHaveBeenCalledWith({ agentId: 'test-agent' });
  });

  it('save handler delegates to service', async () => {
    register(router);
    const h = findHandler('save');
    const sessions = [{ id: 's1' }];
    vi.mocked(sessionService.saveAgentSessions).mockResolvedValue(undefined);

    const result = await h({ agentId: 'test-agent', sessions });

    expect(sessionService.saveAgentSessions).toHaveBeenCalledWith({ agentId: 'test-agent', sessions });
  });

  function findHandler(method) {
    return router.registerApi.mock.calls.find(([, m]) => m === method)[2];
  }
});
