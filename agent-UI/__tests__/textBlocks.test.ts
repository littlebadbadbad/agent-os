/**
 * Tests for agent-UI/components/NetDebug/textBlocks.ts — the line-aware
 * block splitter behind TextViewer. Key invariant: blocks are contiguous,
 * ordered, and their contents concatenate back to the exact original text.
 */

import { describe, it, expect } from 'vitest';

import { splitBlocks, BLOCK_CHARS } from '../components/NetDebug/textBlocks';

/** Every offset covered exactly once, in order, with no gaps or overlaps. */
function expectTotal(text: string): void {
  const blocks = splitBlocks(text);
  let cursor = 0;
  for (const b of blocks) {
    expect(b.start).toBe(cursor);
    expect(b.end).toBe(cursor + b.content.length);
    expect(b.content).toBe(text.slice(b.start, b.end));
    cursor = b.end;
  }
  expect(cursor).toBe(text.length);
}

describe('splitBlocks', () => {
  it('returns nothing for empty text', () => {
    expect(splitBlocks('')).toEqual([]);
  });

  it('keeps short text in a single block', () => {
    const blocks = splitBlocks('hello\nworld');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('hello\nworld');
  });

  it('accumulates whole lines until the budget is reached', () => {
    const line = 'a'.repeat(100) + '\n';
    const text = line.repeat(10); // 1010 chars → ~3 blocks
    const blocks = splitBlocks(text);
    expect(blocks.length).toBeGreaterThan(1);
    for (const b of blocks) {
      // line-aligned: every block ends at a line boundary
      expect(b.content.endsWith('\n') || b.end === text.length).toBe(true);
    }
    expectTotal(text);
  });

  it('hard-splits a single oversized line', () => {
    const text = 'x'.repeat(BLOCK_CHARS * 2 + 37);
    const blocks = splitBlocks(text);
    expectTotal(text);
    // full-size chunks first, remainder last
    expect(blocks[0].content.length).toBe(BLOCK_CHARS);
    expect(blocks.at(-1)?.content.length).toBe(37);
    for (const b of blocks) expect(b.content.length).toBeLessThanOrEqual(BLOCK_CHARS);
  });

  it('flushes pending lines before hard-splitting an oversized one', () => {
    const text = 'short\n' + 'y'.repeat(BLOCK_CHARS + 5);
    const blocks = splitBlocks(text);
    expectTotal(text);
    expect(blocks[0].content).toBe('short\n');
    expect(blocks[1].content.length).toBe(BLOCK_CHARS);
    expect(blocks.at(-1)?.content).toBe('y'.repeat(5));
  });

  it('is total for adversarial mixtures', () => {
    const text = ['a', 'b'.repeat(500), '', 'c'.repeat(300), 'd'].join('\n');
    expectTotal(text);
  });

  it('handles text with no trailing newline', () => {
    const text = 'x'.repeat(BLOCK_CHARS - 1) + '\n' + 'tail';
    expectTotal(text);
    expect(splitBlocks(text).at(-1)?.content).toBe('tail');
  });
});
