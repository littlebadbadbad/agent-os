/**
 * Default permission-checking pipeline.
 *
 * Evaluates tool calls against the declarative rule sets
 * (`alwaysAllowRules` / `alwaysDenyRules` / `alwaysAskRules`) and, when no
 * rule matches, applies a default policy based on the tool's metadata.
 *
 * **Rule-matching order** (first match wins):
 * 1. `alwaysDenyRules`  — fail closed for explicitly denied tools.
 * 2. `alwaysAllowRules` — allow explicitly permitted tools without prompt.
 * 3. `alwaysAskRules`   — require user confirmation.
 * 4. Default policy     — based on tool metadata (see below).
 *
 * **Default policy:**
 * - `bypass` mode          → allow unconditionally.
 * - `restricted` mode      → allow only `isReadOnly` tools; deny others.
 * - `default` mode         → allow, unless the tool is `isDestructive` →
 *                            ask for confirmation.
 *
 * @module
 */

import { resolveToolField } from '@agent-sdk/tools/types';
import type { Tool } from '@agent-type';
import type { PermissionMode, PermissionResult, ToolPermissionContext } from './types';

// ── Wildcard matching ─────────────────────────────────────────────────────────

/**
 * Match a tool name against a permission-rule key.
 *
 * Supports:
 * - Exact match: `"terminal_send"` matches tool name `"terminal_send"`.
 * - Wildcard:    `"terminal_*"` matches any name starting with `"terminal_"`.
 * - Catch-all:   `"*"` matches every tool.
 *
 * The wildcard `*` matches any sequence of characters and appears at most
 * once, at the end of the pattern (`"prefix*"`).  Patterns with `*` in the
 * middle or with multiple `*`s are treated as exact matches (no special
 * interpretation).
 */
export function matchPermissionRule(
  pattern: string,
  toolName: string,
): boolean {
  // Catch-all
  if (pattern === '*') return true;

  // Wildcard suffix
  if (pattern.endsWith('*') && pattern.length > 1) {
    const prefix = pattern.slice(0, -1);
    return toolName.startsWith(prefix);
  }

  // Exact match (also handles `*` in non-suffix positions)
  return pattern === toolName;
}

// ── Rule dispatch ─────────────────────────────────────────────────────────────

/**
 * Resolve a permission rule set's action for a given tool name.
 *
 * Iterates rules in insertion order and returns the action of the first
 * matching rule.  Returns `undefined` when no rule matches.
 */
export function resolveRuleAction(
  rules: Record<string, 'allow' | 'deny' | 'ask'>,
  toolName: string,
): 'allow' | 'deny' | 'ask' | undefined {
  for (const [pattern, action] of Object.entries(rules)) {
    if (matchPermissionRule(pattern, toolName)) {
      return action;
    }
  }
  return undefined;
}

// ── Default permission policy ─────────────────────────────────────────────────

/**
 * Compute the default permission for a tool when no rule matches.
 *
 * **Context-independent defaults:**
 * - `bypass` mode     → allow unconditionally.
 * - `restricted` mode → allow only `isReadOnly` tools.
 * - `default` mode    → allow, but ask for `isDestructive` tools.
 */
function defaultPermission(
  tool: Tool,
  args: Record<string, unknown>,
  mode: PermissionMode,
): PermissionResult {
  if (mode === 'bypass') return { behavior: 'allow' };

  const isReadOnly = resolveToolField(tool.isReadOnly, args as never, false);
  const isDestructive = resolveToolField(tool.isDestructive, args as never, false);

  if (mode === 'restricted') {
    if (isReadOnly) return { behavior: 'allow' };
    return { behavior: 'deny', message: 'Only read-only tools are allowed in restricted mode.' };
  }

  // default mode
  if (isDestructive) {
    return { behavior: 'ask', message: `Allow destructive tool "${tool.name}"?` };
  }

  return { behavior: 'allow' };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Check a tool call against the permission context and tool metadata.
 *
 * This is the **default** permission check — it uses only declarative rules
 * and tool metadata.  When a `PermissionsAdapter` is provided, the adapter's
 * `checkPermission` is used instead of this function.
 *
 * @param toolName  Name of the tool being called.
 * @param args      Zod-validated tool arguments.
 * @param tool      The resolved Tool instance.
 * @param context   The permission context from the current session.
 * @returns The permission result.
 */
export function checkToolPermission(
  toolName: string,
  args: Record<string, unknown>,
  tool: Tool,
  context: ToolPermissionContext,
): PermissionResult {
  // 1. alwaysDenyRules — fail closed
  const denyAction = resolveRuleAction(context.alwaysDenyRules, toolName);
  if (denyAction === 'deny') {
    return { behavior: 'deny', message: `Tool "${toolName}" is denied by a permission rule.` };
  }

  // 2. alwaysAllowRules — explicit allow
  const allowAction = resolveRuleAction(context.alwaysAllowRules, toolName);
  if (allowAction === 'allow') {
    return { behavior: 'allow' };
  }

  // 3. alwaysAskRules — require confirmation
  const askAction = resolveRuleAction(context.alwaysAskRules, toolName);
  if (askAction === 'ask') {
    return { behavior: 'ask', message: `Allow tool "${toolName}"?` };
  }

  // 4. Default: apply the default policy based on mode + metadata
  return defaultPermission(tool, args, context.mode);
}
