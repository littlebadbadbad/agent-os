/**
 * Tests for extensions/browser/backend/transports/ipc/browser.js
 * — Browser IPC stream handlers
 *
 * PURE PROTOCOL LAYER — all business logic is in services/browser.js and
 * BrowserInstance.  We mock the browser manager and service layer to isolate
 * protocol logic.
 *
 * Coverage:
 *   browser:stream:start     — start streaming, config passthrough
 *   browser:stream:stop      — stop streaming, cleanup
 *   browser:stream:input     — dispatch input events
 *   browser:stream:updateConfig — live config update
 *   browser:setViewport      — viewport resize
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../../../../../backend/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Mock browser manager ──────────────────────────────────────────────────────

const mockBrowser = {
  updateStreamConfig: vi.fn(),
  dispatchInput: vi.fn(),
  setViewportSize: vi.fn(),
  startStreamingToWebContents: vi.fn(() => vi.fn()),
  info: vi.fn(() => ({
    id: 'b1',
    alive: true,
    viewport: { width: 1280, height: 720 },
  })),
};

vi.mock('../lib/browser-manager/index.js', () => ({
  getBrowser: vi.fn(() => mockBrowser),
}));

// ── Mock BrowserWindow.fromWebContents ────────────────────────────────────────

const mockWebContents = {
  send: vi.fn(),
  isDestroyed: vi.fn(() => false),
  on: vi.fn(),
};

const mockWin = {
  webContents: mockWebContents,
  on: vi.fn(),
};

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => mockWin),
  },
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────

import { registerBrowserHandlers } from '../transports/ipc/browser.js';
import { getBrowser } from '../lib/browser-manager/index.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function createMockIpcMain() {
  const handlers: Record<string, Function> = {};
  return {
    _handlers: handlers,
    handle(channel: string, fn: Function) { handlers[channel] = fn; },
  };
}

function makeEvent() {
  return {
    sender: {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    },
  };
}

let ipcMain: ReturnType<typeof createMockIpcMain>;

beforeEach(() => {
  vi.clearAllMocks();
  ipcMain = createMockIpcMain();
  registerBrowserHandlers(ipcMain);
});

// ═════════════════════════════════════════════════════════════════════════════
// browser:stream:start
// ═════════════════════════════════════════════════════════════════════════════

describe('browser:stream:start', () => {
  const handler = () => ipcMain._handlers['browser:stream:start'];

  it('starts streaming with default config', async () => {
    const result = await handler()(makeEvent(), { id: 'b1' });

    expect(getBrowser).toHaveBeenCalledWith('b1');
    expect(mockBrowser.startStreamingToWebContents).toHaveBeenCalledWith(mockWebContents);
    expect(mockBrowser.updateStreamConfig).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('applies provided config before starting stream', async () => {
    const result = await handler()(makeEvent(), {
      id: 'b1',
      config: { fps: 30, quality: 50 },
    });

    expect(mockBrowser.updateStreamConfig).toHaveBeenCalledWith({ fps: 30, quality: 50 });
    expect(result).toEqual({ ok: true });
  });

  it('applies partial config', async () => {
    await handler()(makeEvent(), {
      id: 'b1',
      config: { fps: 60 },
    });

    expect(mockBrowser.updateStreamConfig).toHaveBeenCalledWith({ fps: 60 });
  });

  it('throws when id is missing', () => {
    expect(() => handler()(makeEvent(), {})).toThrow();
  });

  it('throws when browser not found', () => {
    (getBrowser as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    expect(() => handler()(makeEvent(), { id: 'nonexistent' })).toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// browser:stream:stop
// ═════════════════════════════════════════════════════════════════════════════

describe('browser:stream:stop', () => {
  const startHandler = () => ipcMain._handlers['browser:stream:start'];
  const stopHandler = () => ipcMain._handlers['browser:stream:stop'];

  it('stops an active stream', async () => {
    const cleanup = vi.fn();
    (mockBrowser.startStreamingToWebContents as ReturnType<typeof vi.fn>).mockReturnValueOnce(cleanup);

    await startHandler()(makeEvent(), { id: 'b1' });
    const result = await stopHandler()(makeEvent(), { id: 'b1' });

    expect(cleanup).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('does nothing when no stream is active for the id', async () => {
    const result = await stopHandler()(makeEvent(), { id: 'b1' });
    expect(result).toEqual({ ok: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// browser:stream:input
// ═════════════════════════════════════════════════════════════════════════════

describe('browser:stream:input', () => {
  const handler = () => ipcMain._handlers['browser:stream:input'];

  it('dispatches input event to the browser', async () => {
    const event = { type: 'mousemove', x: 0.5, y: 0.5 };
    const result = await handler()(makeEvent(), { id: 'b1', event });

    expect(mockBrowser.dispatchInput).toHaveBeenCalledWith(event);
    expect(result).toEqual({ ok: true });
  });

  it('throws when id is missing', async () => {
    await expect(handler()(makeEvent(), { event: {} })).rejects.toThrow(
      'browser:stream:input — id and event are required',
    );
  });

  it('throws when event is missing', async () => {
    await expect(handler()(makeEvent(), { id: 'b1' })).rejects.toThrow(
      'browser:stream:input — id and event are required',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// browser:stream:updateConfig
// ═════════════════════════════════════════════════════════════════════════════

describe('browser:stream:updateConfig', () => {
  const handler = () => ipcMain._handlers['browser:stream:updateConfig'];

  it('updates stream config on the browser', async () => {
    const result = await handler()(makeEvent(), {
      id: 'b1',
      config: { fps: 30 },
    });

    expect(mockBrowser.updateStreamConfig).toHaveBeenCalledWith({ fps: 30 });
    expect(result).toEqual({ ok: true });
  });

  it('throws when config is missing', async () => {
    await expect(handler()(makeEvent(), { id: 'b1' })).rejects.toThrow(
      'browser:stream:updateConfig — id and config are required',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// browser:setViewport
// ═════════════════════════════════════════════════════════════════════════════

describe('browser:setViewport', () => {
  const handler = () => ipcMain._handlers['browser:setViewport'];

  it('resizes the browser viewport', async () => {
    const result = await handler()(makeEvent(), {
      id: 'b1',
      width: 1920,
      height: 1080,
    });

    expect(mockBrowser.setViewportSize).toHaveBeenCalledWith(1920, 1080);
    expect(result).toEqual({
      id: 'b1',
      alive: true,
      viewport: { width: 1280, height: 720 },
    });
  });

  it('throws when required params are missing', async () => {
    await expect(handler()(makeEvent(), { id: 'b1' })).rejects.toThrow(
      'browser:setViewport — id, width, and height are required',
    );
  });
});
