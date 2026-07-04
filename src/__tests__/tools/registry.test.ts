import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  emptyRegistry,
  withTool,
  withoutTool,
  getRegisteredTool,
  listRegisteredTools,
} from '../../tools/registry';
import type { Tool } from '@agent-type';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: z.object({}),
    execute: async () => `result-${name}`,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('emptyRegistry', () => {
  it('creates an empty map', () => {
    const reg = emptyRegistry();
    expect(reg.size).toBe(0);
  });

  it('returns a new instance each call', () => {
    expect(emptyRegistry()).not.toBe(emptyRegistry());
  });
});

describe('withTool', () => {
  it('adds a new tool to an empty registry', () => {
    const tool = makeTool('echo');
    const reg = withTool(emptyRegistry(), tool);
    expect(reg.size).toBe(1);
    expect(reg.get('echo')).toBe(tool);
  });

  it('does not mutate the original registry', () => {
    const orig = emptyRegistry();
    withTool(orig, makeTool('echo'));
    expect(orig.size).toBe(0);
  });

  it('replaces a tool with the same name', () => {
    const toolA = makeTool('echo');
    const toolB = { ...makeTool('echo'), description: 'updated' };
    const reg = withTool(withTool(emptyRegistry(), toolA), toolB);
    expect(reg.size).toBe(1);
    expect(reg.get('echo')!.description).toBe('updated');
  });

  it('accumulates multiple different tools', () => {
    let reg = emptyRegistry();
    reg = withTool(reg, makeTool('a'));
    reg = withTool(reg, makeTool('b'));
    reg = withTool(reg, makeTool('c'));
    expect(reg.size).toBe(3);
  });
});

describe('withoutTool', () => {
  it('removes an existing tool', () => {
    const tool = makeTool('echo');
    const reg = withoutTool(withTool(emptyRegistry(), tool), 'echo');
    expect(reg.size).toBe(0);
    expect(reg.get('echo')).toBeUndefined();
  });

  it('returns the same reference when name is not present', () => {
    const reg = emptyRegistry();
    expect(withoutTool(reg, 'missing')).toBe(reg);
  });

  it('does not mutate the original registry', () => {
    const tool = makeTool('echo');
    const reg = withTool(emptyRegistry(), tool);
    withoutTool(reg, 'echo');
    expect(reg.size).toBe(1);
  });

  it('leaves other tools untouched', () => {
    let reg = emptyRegistry();
    reg = withTool(reg, makeTool('a'));
    reg = withTool(reg, makeTool('b'));
    reg = withoutTool(reg, 'a');
    expect(reg.size).toBe(1);
    expect(reg.get('b')).toBeDefined();
  });
});

describe('getRegisteredTool', () => {
  it('returns the tool when present', () => {
    const tool = makeTool('echo');
    const reg = withTool(emptyRegistry(), tool);
    expect(getRegisteredTool(reg, 'echo')).toBe(tool);
  });

  it('returns undefined for a missing tool', () => {
    expect(getRegisteredTool(emptyRegistry(), 'missing')).toBeUndefined();
  });
});

describe('listRegisteredTools', () => {
  it('returns an empty array for an empty registry', () => {
    expect(listRegisteredTools(emptyRegistry())).toEqual([]);
  });

  it('returns all tools in insertion order', () => {
    let reg = emptyRegistry();
    const a = makeTool('a');
    const b = makeTool('b');
    const c = makeTool('c');
    reg = withTool(reg, a);
    reg = withTool(reg, b);
    reg = withTool(reg, c);
    expect(listRegisteredTools(reg)).toEqual([a, b, c]);
  });

  it('does not include removed tools', () => {
    let reg = emptyRegistry();
    reg = withTool(reg, makeTool('a'));
    reg = withTool(reg, makeTool('b'));
    reg = withoutTool(reg, 'a');
    const names = listRegisteredTools(reg).map((t) => t.name);
    expect(names).toEqual(['b']);
  });
});
