/**
 * Shared types and helper functions for prompt section management.
 *
 * This module provides:
 * 1. Re-exports of all prompt-related types.
 * 2. A `buildDescription()` helper for crafting rich tool descriptions.
 */

import type { SectionId } from '@agent-type';
export { SectionId };
export { createSystemPromptCache, SECTION_IDS } from './section';
export type { SystemPromptCache } from './section';

// ── buildDescription — unified tool-description factory ───────────────────────

/**
 * Craft a readable, usage-oriented tool description.
 *
 * The output follows a consistent structure:
 *
 * ```
 * <summary>
 *
 * When to use:
 * - <scenario 1>
 * - <scenario 2>
 *
 * When NOT to use:
 * - <anti-scenario 1>
 *
 * Behavior:
 * - <rule 1>
 * - <rule 2>
 * ```
 *
 * The returned string is suitable for use as a tool's `description` field
 * or as part of a system-prompt section.
 *
 * @param summary     One-sentence summary of what the tool does.
 * @param whenToUse   Scenarios where this tool is the right choice.
 * @param whenNotToUse Scenarios where a different tool is better.
 * @param behavior    Behavioral rules, edge cases, and failure modes.
 * @param examples    Optional usage examples.
 */
export function buildDescription(
  summary: string,
  whenToUse: readonly string[],
  whenNotToUse: readonly string[],
  behavior: readonly string[],
  examples?: readonly string[],
): string {
  const parts: string[] = [summary];

  if (whenToUse.length > 0) {
    parts.push('', 'When to use:', ...whenToUse.map((s) => `- ${s}`));
  }

  if (whenNotToUse.length > 0) {
    parts.push('', 'When NOT to use:', ...whenNotToUse.map((s) => `- ${s}`));
  }

  if (behavior.length > 0) {
    parts.push('', 'Behavior:', ...behavior.map((s) => `- ${s}`));
  }

  if (examples && examples.length > 0) {
    parts.push('', 'Examples:', ...examples.map((s) => `- ${s}`));
  }

  return parts.join('\n');
}
