import type { Tool } from '@agent-type';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * An immutable snapshot of the registered tool set, keyed by tool name.
 * All mutation helpers return a *new* registry rather than mutating in place.
 */
export type ToolRegistry = ReadonlyMap<string, Tool>;

// ── Constructors ──────────────────────────────────────────────────────────────

/** Create a new, empty registry. */
export const emptyRegistry = (): ToolRegistry => new Map<string, Tool>();

// ── Pure update helpers ───────────────────────────────────────────────────────

/**
 * Return a new registry with `tool` added (or replaced if the name already
 * exists).  The original registry is never mutated.
 */
export const withTool = (registry: ToolRegistry, tool: Tool): ToolRegistry => {
  const next = new Map(registry);
  next.set(tool.name, tool);
  return next;
};

/**
 * Return a new registry with the tool identified by `name` removed.
 * If the name is not present the original registry is returned unchanged
 * (reference equality preserved — safe for React `useRef` comparisons).
 */
export const withoutTool = (registry: ToolRegistry, name: string): ToolRegistry => {
  if (!registry.has(name)) return registry;
  const next = new Map(registry);
  next.delete(name);
  return next;
};

// ── Query helpers ─────────────────────────────────────────────────────────────

/** Look up a single tool by name. */
export const getRegisteredTool = (
  registry: ToolRegistry,
  name: string,
): Tool | undefined => registry.get(name);

/** Return all registered tools as an ordered array (insertion order). */
export const listRegisteredTools = (registry: ToolRegistry): readonly Tool[] =>
  Array.from(registry.values());
