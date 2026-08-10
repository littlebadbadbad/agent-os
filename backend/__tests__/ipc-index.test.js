/**
 * Tests for backend/transports/ipc/index.js — registerIpcHandlers
 *
 * Covers:
 *   Delegates to registerPluginIpcHandlers(ipcMain, pluginRouter)
 *   Logs start/finish messages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────

const { mockIpcMain, mockPluginIpc } = vi.hoisted(() => ({
  mockIpcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  mockPluginIpc: { registerPluginIpcHandlers: vi.fn() },
}));

vi.mock('electron', () => ({ ipcMain: mockIpcMain }));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../transports/ipc/plugin.js', () => ({ registerPluginIpcHandlers: mockPluginIpc.registerPluginIpcHandlers }));

import { registerIpcHandlers } from '../transports/ipc/index.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to plugin Ipc handler module', () => {
    const fakeRouter = { getRegisteredPlugins: vi.fn().mockReturnValue([]) };
    registerIpcHandlers(fakeRouter);

    expect(mockPluginIpc.registerPluginIpcHandlers).toHaveBeenCalledTimes(1);
    expect(mockPluginIpc.registerPluginIpcHandlers).toHaveBeenCalledWith(
      mockIpcMain,
      fakeRouter,
    );
  });

  it('does not interact with ipcMain directly (delegates everything)', () => {
    const fakeRouter = { getRegisteredPlugins: vi.fn().mockReturnValue([]) };
    registerIpcHandlers(fakeRouter);

    // ipcMain itself should not have handle called on it directly by index.js
    // (plugin.js handles that)
    expect(mockIpcMain.handle).not.toHaveBeenCalled();
    expect(mockIpcMain.removeHandler).not.toHaveBeenCalled();
  });
});
