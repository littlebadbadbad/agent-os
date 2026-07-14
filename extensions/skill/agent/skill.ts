import type { Tool } from '@agent-type';

// ── Skill definition ──────────────────────────────────────────────────────────

/**
 * A **Skill** is a named, self-contained capability bundle that provides:
 *
 * 1. **Tools** — one or more `Tool` definitions the agent can call.
 * 2. **System prompt fragment** — instructions appended to the agent's base
 *    system prompt while the skill is active, telling the AI what the skill
 *    does and when to use its tools.
 * 3. **Lifecycle hooks** — optional async `setup` / teardown for skills that
 *    need initialization (connect to a service, fetch config, etc.).
 *
 * Skills are the primary unit of capability composition. They let you:
 * - Bundle related tools with usage guidance into a single installable unit.
 * - Load / unload capabilities at runtime without restarting the agent.
 * - Enable / disable a skill (and all its tools) with one call.
 * - Distribute reusable agent capabilities as packages.
 */
export type Skill = {
  /** Unique identifier, e.g. `'web-search'`, `'board-management'`. */
  readonly name: string;
  /** Human-readable summary of what this skill provides. */
  readonly description: string;
  /** Semantic version, e.g. `'1.0.0'`. Informational only. */
  readonly version?: string;
  /** Author or source attribution. Informational only. */
  readonly author?: string;
  /**
   * Tools this skill provides.
   *
   * - **Static array** — for skills whose tool set is known at definition time.
   * - **Factory function** `() => Tool[]` — for lazy / dynamic initialization
   *   (e.g. tools generated from runtime configuration).
   */
  readonly tools: readonly Tool[] | (() => readonly Tool[]);
  /**
   * System prompt fragment appended to the agent's base system prompt while
   * this skill is active.
   *
   * Use it to instruct the AI about capabilities, usage guidelines, tool
   * selection heuristics, and expected input/output formats.
   *
   * When multiple skills are active their fragments are joined with double
   * newlines and appended after the base system prompt.
   */
  readonly systemPrompt?: string;
  /**
   * Async setup hook called when the skill is loaded via `loadSkill()`.
   *
   * Use for initialization that must complete before tools are usable
   * (connecting to external services, fetching dynamic config, warming caches).
   *
   * May return a **teardown function** invoked on `unloadSkill()`.
   *
   * > **Note:** Skills loaded via the `skills` config array are registered
   * > synchronously (tools + prompt only). If a skill needs async setup, load
   * > it with `await agent.loadSkill(skill)` instead.
   */
  readonly setup?: () => Promise<(() => void) | void> | ((() => void) | void);
};

// ── Snapshot type ─────────────────────────────────────────────────────────────

/** Read-only snapshot of a loaded skill's state, surfaced to external consumers. */
export type SkillState = {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly toolCount: number;
  readonly toolNames: readonly string[];
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Identity helper that constructs a frozen `Skill` with full type safety.
 *
 * @example
 * ```ts
 * import { defineSkill, defineTool } from 'agent-sdk';
 *
 * const mySkill = defineSkill({
 *   name: 'my-skill',
 *   description: 'Does amazing things',
 *   tools: [toolA, toolB],
 *   systemPrompt: 'You have access to my-skill. Use tool_a when …',
 * });
 * ```
 */
export function defineSkill(skill: Skill): Skill {
  return Object.freeze(skill);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Resolve the tools array from a skill (handles both static and factory forms). */
export function resolveSkillTools(skill: Skill): readonly Tool[] {
  return typeof skill.tools === 'function' ? skill.tools() : skill.tools;
}
