/**
 * Tests for agent-UI/env.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('env detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects standalone when no electronAPI', async () => {
    vi.stubGlobal('window', {});
    vi.resetModules();

    const { IS_ELECTRON_IPC, IS_STANDALONE, detectEnvironment } = await import('../env');

    expect(IS_ELECTRON_IPC).toBe(false);
    expect(IS_STANDALONE).toBe(true);
    expect(detectEnvironment()).toBe('standalone');
  });

  it('detects standalone when window is undefined', async () => {
    vi.stubGlobal('window', undefined);
    vi.resetModules();

    const { detectEnvironment } = await import('../env');

    expect(detectEnvironment()).toBe('standalone');
  });

  it('detects standalone when electronAPI is missing invoke', async () => {
    vi.stubGlobal('window', { electronAPI: {} });
    vi.resetModules();

    const { detectEnvironment } = await import('../env');

    expect(detectEnvironment()).toBe('standalone');
  });

  it('detects electron-ipc when window.electronAPI.invoke exists', async () => {
    vi.stubGlobal('window', { electronAPI: { invoke: vi.fn() } });
    vi.resetModules();

    const { IS_ELECTRON_IPC, IS_STANDALONE, detectEnvironment } = await import('../env');

    expect(IS_ELECTRON_IPC).toBe(true);
    expect(IS_STANDALONE).toBe(false);
    expect(detectEnvironment()).toBe('electron-ipc');
  });
});
