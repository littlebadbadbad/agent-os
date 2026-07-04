/**
 * Prompt-section infrastructure for the system-prompt assembly pipeline.
 *
 * Export surface:
 * - `SectionId` type — strict string literal union of all known section names
 * - `SECTION_IDS` array — canonical list (runtime enum)
 * - `createSystemPromptCache()` / `SystemPromptCache` — per-session section cache
 * - `buildDescription()` — helper for crafting rich tool descriptions
 *
 * @module
 */

export { createSystemPromptCache, SECTION_IDS } from './section';
export type { SystemPromptCache } from './section';
export type { SectionId } from '@agent-type';

export { buildDescription } from './types';
