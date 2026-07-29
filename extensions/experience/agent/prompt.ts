/**
 * extensions/experience/agent/prompt.ts — System-prompt section builders
 *
 * Provides section ID constant and the dense experience block injected
 * into the system prompt before every turn so the agent can pattern-match
 * against past experience without an explicit read call.
 */

import type { ExperienceItem } from './types';

function serializeForPrompt(e: ExperienceItem): string {
  const meta = [
    `id=${e.id.slice(0, 8)}`,
    `ts=${e.createdAt}`,
    e.confidence !== undefined ? `conf=${e.confidence.toFixed(2)}` : null,
    e.tags?.length ? e.tags.map((t) => `#${t}`).join(' ') : null,
  ].filter(Boolean).join(' | ');

  const lines = [
    `[${meta}]`,
    `  TRIGGER  ${e.trigger}`,
    `  INSIGHT  ${e.insight}`,
  ];
  if (e.evidence) lines.push(`  EVIDENCE ${e.evidence}`);
  return lines.join('\n');
}

export function buildExperienceSectionContent(
  items: readonly ExperienceItem[],
): string {
  if (!items.length) {
    return (
      '## Experience\n' +
      'After completing non-trivial work, call experience_add to persist ' +
      'patterns, API quirks, or effective strategies. Skip general knowledge.'
    );
  }

  const blocks = items.map(serializeForPrompt).join('\n\n');
  return (
    `## Experience\n` +
    `After completing non-trivial work, call experience_add to persist reusable patterns.\n` +
    `Scan entries below before acting:\n\n` +
    blocks
  );
}
