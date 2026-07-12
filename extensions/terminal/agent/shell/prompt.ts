/**
 * Enhanced prompt descriptions for the Terminal ToolSet.
 *
 * Each description follows a uniform structure:
 *   1. **Summary** — one-line purpose statement.
 *   2. **When to use** — concrete scenarios where this tool is the right choice.
 *   3. **Behavior notes** — subtle details, defaults, edge cases, and gotchas.
 *
 * Import these constants from ToolSet implementations that compose the
 * system prompt via `ToolSet.onGetSystemPrompt`.
 *
 * @module
 */

import type { SectionId } from '@agent-type';

// ── Section identifier ────────────────────────────────────────────────────────

/**
 * Section ID for the Terminal system-prompt section.
 * Registered in `SECTION_IDS` so that `SectionId` resolves to it.
 */
export const TERMINAL_SECTION_ID: SectionId = 'terminal';
