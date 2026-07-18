// ── Tool family identification ────────────────────────────────────────────────
//
// Pure predicates — no React, no imports.  Import from anywhere without cost.

export function isSubAgentMetaTool(name: string): boolean {
  return name.endsWith('_subagent') || name.endsWith('_subagents');
}
