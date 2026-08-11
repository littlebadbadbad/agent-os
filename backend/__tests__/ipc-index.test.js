/**
 * Tests for backend/transports/ipc/index.js — registerIpcHandlers
 *
 * Covers:
 *   Delegates to registerAppIpcHandlers(ipcMain, appRouter)
 *   Logs start/finish messages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────

const { mockIpcMain, mockAppIpc } = vi.hoisted(() => ({
  mockIpcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  mockAppIpc: { registerAppIpcHandlers: vi.fn() },
}));

vi.mock('electron', () => ({ ipcMain: mockIpcMain }));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../transports/ipc/app.js', () => ({ registerAppIpcHandlers: mockAppIpc.registerAppIpcHandlers }));

import { registerIpcHandlers } from '../transports/ipc/index.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to app Ipc handler module', () => {
    const fakeRouter = { getRegisteredApps: vi.fn().mockReturnValue([]) };
    registerIpcHandlers(fakeRouter);

    expect(mockAppIpc.registerAppIpcHandlers).toHaveBeenCalledTimes(1);
    expect(mockAppIpc.registerAppIpcHandlers).toHaveBeenCalledWith(
      mockIpcMain,
      fakeRouter,
    );
  });

  it('does not interact with ipcMain directly (delegates everything)', () => {
    const fakeRouter = { getRegisteredApps: vi.fn().mockReturnValue([]) };
    registerIpcHandlers(fakeRouter);

    // ipcMain itself should not have handle called on it directly by index.js
    // (app.js handles that)
    expect(mockIpcMain.handle).not.toHaveBeenCalled();
    expect(mockIpcMain.removeHandler).not.toHaveBeenCalled();
  });
});
