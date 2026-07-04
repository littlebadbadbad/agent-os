/**
 * System-prompt primitives for the Experience ToolSet.
 *
 * Provides section ID constant, enriched tool descriptions (with when-to-use,
 * when-NOT-to-use, and behavior notes), and the section content builder that
 * renders the dense experience block injected into the system prompt.
 *
 * @module
 */

import type { SectionId } from '@agent-type';
import type { ExperienceItem } from './experience';

// ── Section ID ────────────────────────────────────────────────────────────────

/**
 * Unique section identifier for the experience block in the system prompt.
 *
 * Registered in `SECTION_IDS` at `src/tools/prompts/section.ts`.
 */
export const EXPERIENCE_SECTION_ID: SectionId = 'experience';

// ── Serialisation ─────────────────────────────────────────────────────────────

/**
 * Serialise one experience entry to the dense system-prompt block format.
 *
 * Produces a compact, machine-readable representation suitable for injection
 * into the system prompt. Each entry renders as:
 *
 * ```
 * [id=<short> | ts=<date> | conf=<score> | #tag1 #tag2]
 *   TRIGGER  <activation condition>
 *   INSIGHT  <actionable rule>
 *   EVIDENCE <causal chain>         (optional)
 * ```
 */
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

// ── Section content builder ───────────────────────────────────────────────────

/**
 * Build the system-prompt section content for the Experience ToolSet.
 *
 * When no items exist, returns a short guidance message telling the agent to
 * call `experience_add` after non-trivial work. When items exist, renders the
 * full dense block with a header and a scan directive.
 *
 * This function encodes the same logic as the previous inline
 * `onGetSystemPrompt` implementation, extracted here so that both the
 * legacy ToolSet and the new section-based pipeline share one source.
 *
 * @param items - The full list of global experience entries to render.
 *                Pass an empty array when the pool is empty.
 * @returns The section content, or `undefined` if there are no items and the
 *          guidance header is undesired (currently never returns undefined).
 */
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
