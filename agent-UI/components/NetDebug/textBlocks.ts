/**
 * textBlocks.ts — pure line-aware splitter used by TextViewer to turn long
 * concatenated stream text into independently foldable blocks.
 *
 * Total by construction: every offset in [0, text.length) belongs to exactly
 * one block; blocks are contiguous and ordered; no block exceeds BLOCK_CHARS
 * except when a hard-split tail is shorter than the budget.
 */

export interface TextBlock {
  /** Start offset (inclusive). */
  readonly start: number;
  /** End offset (exclusive). */
  readonly end: number;
  readonly content: string;
}

/** Target size of one foldable block (characters). */
export const BLOCK_CHARS = 420;
/** Preview length shown for a folded block. */
export const PREVIEW_CHARS = 80;

/**
 * Split text into foldable blocks: line-aligned, each ≈ BLOCK_CHARS long.
 * Lines longer than BLOCK_CHARS are hard-split first, so every emitted block
 * is ≤ BLOCK_CHARS (except a hard-split tail) and the pass never throws.
 */
export function splitBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let start = 0; // offset of the block being accumulated
  let cur = 0; // scan position (end of accumulated content so far)

  const flush = (end: number): void => {
    if (end > start) {
      blocks.push({ start, end, content: text.slice(start, end) });
      start = end;
    }
  };

  let lineStart = 0;
  while (lineStart < text.length) {
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? text.length : nl + 1;

    if (lineEnd - lineStart > BLOCK_CHARS) {
      // Oversized line: flush what we have, then hard-split the line itself.
      flush(cur);
      let cut = lineStart;
      while (lineEnd - cut > BLOCK_CHARS) {
        cut += BLOCK_CHARS;
        flush(cut);
      }
      flush(lineEnd);
      cur = lineEnd;
    } else {
      cur = lineEnd;
      if (cur - start >= BLOCK_CHARS) flush(cur);
    }
    lineStart = lineEnd;
  }
  flush(text.length);
  return blocks;
}
