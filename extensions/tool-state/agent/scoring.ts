import type { Tool } from '@agent-type';

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(str: string): string {
  return str.replace(REGEXP_SPECIAL, '\\$&');
}

function wordBoundaryTest(source: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`).test(source);
}

/**
 * Resolve a tool's description, handling both static strings and zero-arg
 * factory functions (used by dynamic tools).
 */
export function resolveDescription(tool: Tool): string {
  const desc = tool.description;
  return typeof desc === 'function' ? desc() : desc;
}

/**
 * Score a tool's relevance against multiple lowercase query words.
 *
 * Scoring strategy (cumulative):
 *   Exact name match             → +100
 *   Name contains word (boundary) → +75
 *   Name contains word (mid-word) → +50
 *   Description contains (boundary) → +30
 *   Description contains (mid-word) → +20
 *   Group name contains word       → +10
 *
 * Only tools with score > 0 are considered matches.
 */
export function scoreTool(tool: Tool, queryWords: string[]): number {
  if (queryWords.length === 0) return 0;

  const name = tool.name.toLowerCase();
  const desc = resolveDescription(tool).toLowerCase();
  const group = (tool.group ?? '').toLowerCase();

  let score = 0;

  for (const word of queryWords) {
    if (word.length === 0) continue;

    if (name === word) {
      score += 100;
      continue;
    }

    if (name.includes(word)) {
      score += wordBoundaryTest(name, word) ? 75 : 50;
    }

    if (desc.includes(word)) {
      score += wordBoundaryTest(desc, word) ? 30 : 20;
    }

    if (group.length > 0 && group.includes(word)) {
      score += 10;
    }
  }

  return score;
}
