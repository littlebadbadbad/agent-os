/**
 * Prompt section primitives for the system-prompt assembly pipeline.
 *
 * `SystemPromptCache` lives at the session level, created per session in
 * `sessionFactory.ts` and per sub-agent in `registry.ts`.  It avoids
 * recomputing static sections on every LLM turn.
 *
 * ToolSets declare sections via the optional `sectionId` / `sectionPriority`
 * fields on the `ToolSet` type.  The `buildSystemPrompt` function in
 * `agentRuntime.ts` sorts and deduplicates by `sectionId`.
 */

import type { SectionId } from '@agent-type';

// ── Section ID ────────────────────────────────────────────────────────────────

// SectionId type is now defined in @agent-type/toolset.ts

/**
 * Canonical list of all known section identifiers.
 *
 * Defined once here, imported by every module that registers a section.
 * The `SectionId` type is automatically derived from this array, so
 * adding a new entry here is sufficient to make it available everywhere.
 */
export const SECTION_IDS = [
  'output_efficiency', // Output efficiency guidance (priority 5)
  'tone_style',        // Communication style rules (priority 7)
  'identity',          // Agent identity & base system prompt (priority 10)
  'doing_tasks',       // Code-style & workflow discipline (priority 15)
  'efficiency',        // Context management & token saving guidance (priority 20)
  'tools_philosophy',  // How to choose and use tools wisely (priority 25)
  'permissions',       // Permission rules & tool access control
  'planning',          // Planning tools (plan_write, plan_checkpoint)
  'task_tracking',     // Task tracking & checklist management
  'experience',        // Experience / memory records
  'subagent',          // Sub-agent delegation strategy
  'file',              // File management tools
  'terminal',          // Terminal / shell tools
  'browser',           // Browser automation tools
  'variable',          // Variable store tools
  'git',               // Git operations
  'mcp',               // MCP server management
  'memory_graph',      // Knowledge graph / memory graph
  'upgrade',           // Self-upgrade / build tools
] as const;

// ── Section cache ─────────────────────────────────────────────────────────────

/**
 * Per-session cache for system-prompt sections.
 *
 * Created once at session creation time (`sessionFactory.ts` / `registry.ts`)
 * and passed to every call of `buildSystemPrompt`.  Sections with
 * `cacheable: true` are stored after the first computation and served
 * from the cache on subsequent turns until `invalidate()` is called.
 */
export interface SystemPromptCache {
  /**
   * Resolve a section's value — either from cache or by calling `compute`.
   *
   * @param id      Section identifier (used as cache key).
   * @param compute Factory that produces the section content.
   * @returns The section text, or `undefined` when `compute` returned
   *          `undefined` (meaning "no content to inject for this section").
   *          `undefined` results are **not cached** — the computation
   *          is retried on the next turn (catering to ToolSets whose
   *          state may change before the next call).
   */
  resolve(id: SectionId, compute: () => string | undefined): string | undefined;
  /**
   * Purge all cached section values.
   *
   * Call this when the session is reset (`onResetSession`) so that the
   * next LLM turn gets fresh system prompt content.
   */
  invalidate(): void;
  /** Expose current cache state for debugging / testing. Returns a frozen snapshot. */
  readonly entries: ReadonlyMap<SectionId, string>;
}

/**
 * Create a per-session `SystemPromptCache`.
 *
 * @example
 * ```ts
 * const cache = createSystemPromptCache();
 * const identity = cache.resolve('identity', () => '## Identity\n...');  // computed
 * const identity = cache.resolve('identity', () => '## Identity\n...');  // cached
 * cache.invalidate();
 * const identity = cache.resolve('identity', () => '## Identity\n...');  // recomputed
 * ```
 */
export function createSystemPromptCache(): SystemPromptCache {
  const store = new Map<SectionId, string>();

  return {
    resolve(id: SectionId, compute: () => string | undefined): string | undefined {
      const cached = store.get(id);
      if (cached !== undefined) return cached;

      const value = compute();
      if (value !== undefined) {
        store.set(id, value);
      }
      return value;
    },

    invalidate(): void {
      store.clear();
    },

    get entries(): ReadonlyMap<SectionId, string> {
      return store;
    },
  };
}


