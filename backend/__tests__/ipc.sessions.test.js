/**
 * Tests for backend/transports/ipc/sessions.js — Session IPC handlers
 *
 * Pure protocol-layer passthrough.
 *   sessions:load → service.loadAgentSessions(params)
 *   sessions:save → service.saveAgentSessions(params)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

const mockService = vi.hoisted(() => ({
  loadAgentSessions: vi.fn(),
  saveAgentSessions: vi.fn(),
}));

vi.mock('../services/sessions.js', () => mockService);

import { registerSessionHandlers } from '../transports/ipc/sessions.js';

function createMockIpcMain() {
  const handlers = {};
  return {
    _handlers: handlers,
    handle(channel, fn) { handlers[channel] = fn; },
  };
}

function makeEvent() {
  return { sender: { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) } };
}

let ipcMain;

beforeEach(() => {
  vi.clearAllMocks();
  ipcMain = createMockIpcMain();
  registerSessionHandlers(ipcMain);
});

describe('sessions:* IPC handlers', () => {
  it('sessions:load calls service.loadAgentSessions', async () => {
    const sessions = [{ id: 's1', turns: [] }];
    mockService.loadAgentSessions.mockResolvedValue({ sessions });

    const result = await ipcMain._handlers['sessions:load'](makeEvent(), { agentId: 'async-agent' });
    expect(mockService.loadAgentSessions).toHaveBeenCalledWith({ agentId: 'async-agent' });
    expect(result).toEqual({ sessions });
  });

  it('sessions:save calls service.saveAgentSessions', async () => {
    const params = { agentId: 'async-agent', sessions: [{ id: 's1' }] };
    mockService.saveAgentSessions.mockResolvedValue({ ok: true });

    const result = await ipcMain._handlers['sessions:save'](makeEvent(), params);
    expect(mockService.saveAgentSessions).toHaveBeenCalledWith(params);
    expect(result).toEqual({ ok: true });
  });
});
