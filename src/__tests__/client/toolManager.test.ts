import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createToolManager } from '../../client/toolManager';
import type { Tool } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTool(name: string, group?: string): Tool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: z.object({}),
    group,
    execute: async () => null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createToolManager', () => {
  // ── registerTool ───────────────────────────────────────────────────────────

  it('registers a tool and exposes it in getRegistry', () => {
    const mgr = createToolManager();
    mgr.registerTool(makeTool('echo'));
    expect(mgr.getRegistry().has('echo')).toBe(true);
  });

  it('unregister callback removes the tool', () => {
    const mgr = createToolManager();
    const unregister = mgr.registerTool(makeTool('echo'));
    unregister();
    expect(mgr.getRegistry().has('echo')).toBe(false);
  });

  it('notifies subscribers on register and unregister', () => {
    const mgr = createToolManager();
    const listener = vi.fn();
    mgr.subscribe(listener);
    mgr.registerTool(makeTool('echo'));
    expect(listener).toHaveBeenCalledTimes(1);
    mgr.getRegistry(); // no-op
    const unregister = mgr.registerTool(makeTool('ping'));
    expect(listener).toHaveBeenCalledTimes(2);
    unregister();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  // ── getTools ───────────────────────────────────────────────────────────────

  it('returns all registered tools', () => {
    const mgr = createToolManager();
    mgr.registerTool(makeTool('a'));
    mgr.registerTool(makeTool('b'));
    const tools = mgr.getTools();
    expect(tools.map((t) => t.name)).toContain('a');
    expect(tools.map((t) => t.name)).toContain('b');
  });

  it('returns empty array when no tools are registered', () => {
    const mgr = createToolManager();
    expect(mgr.getTools()).toHaveLength(0);
  });

  it('does not include unregistered tools', () => {
    const mgr = createToolManager();
    const unregister = mgr.registerTool(makeTool('a'));
    mgr.registerTool(makeTool('b'));
    unregister();
    expect(mgr.getTools().map((t) => t.name)).not.toContain('a');
    expect(mgr.getTools().map((t) => t.name)).toContain('b');
  });

  // ── subscribe ──────────────────────────────────────────────────────────────

  it('subscribe returns an unsubscribe function', () => {
    const mgr = createToolManager();
    const listener = vi.fn();
    const unsub = mgr.subscribe(listener);
    unsub();
    mgr.registerTool(makeTool('a'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('multiple subscribers are all notified', () => {
    const mgr = createToolManager();
    const l1 = vi.fn();
    const l2 = vi.fn();
    mgr.subscribe(l1);
    mgr.subscribe(l2);
    mgr.registerTool(makeTool('a'));
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });

  // ── unregisterByName ───────────────────────────────────────────────────────

  it('unregisterByName removes the tool from the registry', () => {
    const mgr = createToolManager();
    mgr.registerTool(makeTool('a'));
    mgr.unregisterByName('a');
    expect(mgr.getRegistry().has('a')).toBe(false);
  });

  it('unregisterByName is a no-op for an unknown name', () => {
    const mgr = createToolManager();
    expect(() => mgr.unregisterByName('ghost')).not.toThrow();
  });

  it('unregisterByName notifies subscribers', () => {
    const mgr = createToolManager();
    const listener = vi.fn();
    mgr.subscribe(listener);
    mgr.registerTool(makeTool('a'));
    listener.mockClear();
    mgr.unregisterByName('a');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('calling unregister callback after unregisterByName is idempotent', () => {
    const mgr = createToolManager();
    const listener = vi.fn();
    mgr.subscribe(listener);
    const unregister = mgr.registerTool(makeTool('a'));
    mgr.unregisterByName('a');
    listener.mockClear();
    expect(() => unregister()).not.toThrow();
    // No extra notification — tool was already gone
    expect(listener).not.toHaveBeenCalled();
  });

  // ── entryData ──────────────────────────────────────────────────────────────

  it('stores entryData when provided', () => {
    const entryData = { id: 's1', title: 'My Session' };
    const mgr = createToolManager(entryData);
    expect(mgr.entryData).toEqual(entryData);
  });

  it('uses fallback entryData when none is provided', () => {
    const mgr = createToolManager();
    expect(mgr.entryData).toEqual({ id: '', title: '' });
  });

  // ── externalRefresh ────────────────────────────────────────────────────────

  it('initialises externalRefresh to null', () => {
    const mgr = createToolManager();
    expect(mgr.externalRefresh).toBeNull();
  });

  it('externalRefresh can be set and cleared', () => {
    const mgr = createToolManager();
    const fn = vi.fn();
    mgr.externalRefresh = fn;
    expect(mgr.externalRefresh).toBe(fn);
    mgr.externalRefresh = null;
    expect(mgr.externalRefresh).toBeNull();
  });
});