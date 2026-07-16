import { describe, it, expect, vi } from 'vitest';
import { createBrowserToolSet } from '../toolSet';
import type { BrowserAdapter } from '../types';

function makeTsCtx(sessionId = 'session-1') {
  return { sessionId, agentName: 'main', conversationId: 'main' };
}

function makeBrowserAdapter(): BrowserAdapter {
  return {
    listBrowsers:   vi.fn().mockResolvedValue([]),
    launchBrowser:  vi.fn(),
    closeBrowser:   vi.fn().mockResolvedValue(undefined),
    navigate:       vi.fn().mockResolvedValue({}),
    snapshot:       vi.fn().mockResolvedValue({}),
    click:          vi.fn().mockResolvedValue({}),
    type:           vi.fn().mockResolvedValue({}),
    scroll:         vi.fn().mockResolvedValue({}),
    wait:           vi.fn().mockResolvedValue({}),
    evaluate:       vi.fn().mockResolvedValue({}),
    screenshot:     vi.fn().mockResolvedValue({}),
    streamScreenshot: vi.fn().mockReturnValue(() => {}),
    sendInput:      vi.fn().mockResolvedValue({}),
  } as unknown as BrowserAdapter;
}

// ── createBrowserToolSet ──────────────────────────────────────────────────────

describe('createBrowserToolSet', () => {
  it('returns a ToolSet with name "browser"', () => {
    const ts = createBrowserToolSet(makeBrowserAdapter());
    expect(ts.name).toBe('browser');
  });

  it('exposes the adapter via .adapter property', () => {
    const adapter = makeBrowserAdapter();
    const ts = createBrowserToolSet(adapter) as any;
    expect(ts.adapter).toBe(adapter);
  });

  it('tools is an array (eager form)', () => {
    const ts = createBrowserToolSet(makeBrowserAdapter());
    expect(Array.isArray(ts.tools)).toBe(true);
  });

  it('resolving tools() returns the browser tools', () => {
    const ts = createBrowserToolSet(makeBrowserAdapter());
    const tools = typeof ts.tools === 'function' ? ts.tools() : ts.tools;
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t: { name: string }) => typeof t.name === 'string')).toBe(true);
  });

  it('onGetState returns { browserAdapter: adapter }', () => {
    const adapter = makeBrowserAdapter();
    const ts = createBrowserToolSet(adapter);
    expect(ts.onGetState?.(makeTsCtx('session-1'))).toEqual({ browserAdapter: adapter });
  });

  it('does not implement onInit, onReset, or onBuildSnapshot', () => {
    const ts = createBrowserToolSet(makeBrowserAdapter());
    expect(ts.onInit).toBeUndefined();
    expect(ts.onReset).toBeUndefined();
    expect(ts.onBuildSnapshot).toBeUndefined();
  });
});
