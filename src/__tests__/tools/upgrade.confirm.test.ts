import { describe, it, expect, vi, afterEach } from 'vitest';
import { autoConfirm, defaultBrowserConfirm } from '../../tools/upgrade/confirm';

describe('defaultBrowserConfirm', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  });

  it('returns null when window is undefined', async () => {
    delete (globalThis as any).window;
    const result = await defaultBrowserConfirm('Proceed?');
    expect(result).toBeNull();
  });

  it('returns the result of window.confirm when window is defined', async () => {
    const confirmMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis, 'window', {
      value: { confirm: confirmMock },
      writable: true,
      configurable: true,
    });
    const result = await defaultBrowserConfirm('Proceed?');
    expect(result).toBe(true);
    expect(confirmMock).toHaveBeenCalledWith('Proceed?');
  });
});

describe('autoConfirm', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  });

  it('returns defaultBrowserConfirm when window is defined', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { confirm: vi.fn() },
      writable: true,
      configurable: true,
    });
    const fn = autoConfirm();
    expect(fn).toBe(defaultBrowserConfirm);
  });

  it('returns defaultTerminalConfirm when window is undefined', () => {
    delete (globalThis as any).window;
    const fn = autoConfirm();
    // In a test environment without readline, the returned function should
    // be the terminal confirm (which will return null since readline isn't available)
    expect(typeof fn).toBe('function');
    expect(fn).not.toBe(defaultBrowserConfirm);
  });
});
