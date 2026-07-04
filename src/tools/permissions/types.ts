/**
 * Permission types for the SDK's tool-permission system.
 *
 * The permission system uses a two-layer model:
 *
 * 1. **Rule layer** (`alwaysAllowRules` / `alwaysDenyRules` / `alwaysAskRules`) —
 *    static, declarative rules keyed by tool name (with wildcard support).
 *    Evaluated before any tool-specific or adapter-based logic.
 *
 * 2. **Adapter layer** (`PermissionsAdapter`) — programmatic,
 *    environment-provided logic that can inspect the full tool metadata and
 *    input.  Used by SDK consumers that need custom permission UIs or policies.
 *
 * Both layers are wired into the tool-execution pipeline via the
 * `onBeforeToolExecute` lifecycle hook on `PermissionsToolSet`.
 *
 * @module
 */

// ── Permission modes ──────────────────────────────────────────────────────────

/**
 * The permission mode for the current execution context.
 *
 * - `'default'`    — normal permissions (rules + adapter applied).
 * - `'bypass'`     — all permission checks are skipped (developer mode).
 * - `'restricted'` — only read-only tools are allowed (plan mode, review mode).
 */
export type PermissionMode = 'default' | 'bypass' | 'restricted';

// ── Permission result ─────────────────────────────────────────────────────────

/**
 * Outcome of a single permission check.
 *
 * - `allow` — the tool call may proceed.  `updatedInput` lets the checker
 *   rewrite arguments (e.g. to canonicalise paths) before execution.
 * - `deny`  — the tool call is rejected with a user-visible message.
 * - `ask`   — the tool call requires user confirmation before proceeding.
 */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }
  | { behavior: 'ask'; message: string };

// ── Permission rules ──────────────────────────────────────────────────────────

/**
 * A set of permission rules keyed by tool-name pattern.
 *
 * Keys support wildcard matching (`*` matches any sequence of characters):
 * - `"terminal_send"`        — exact match
 * - `"terminal_*"`           — all tools whose name starts with `terminal_`
 * - `"*"`                    — every tool
 *
 * Values specify the action for matched tools.
 */
export type PermissionRules = Record<string, 'allow' | 'deny' | 'ask'>;

// ── Permission context ────────────────────────────────────────────────────────

/**
 * Full permission context injected into every tool execution.
 *
 * Wired by `PermissionsToolSet.onPatchToolContext` and accessible inside any
 * tool's `execute` function via `context.permissionContext`.
 */
export type ToolPermissionContext = {
  /** The current permission mode. */
  mode: PermissionMode;

  /** Rules that unconditionally allow specific tools. */
  alwaysAllowRules: PermissionRules;

  /** Rules that unconditionally deny specific tools. */
  alwaysDenyRules: PermissionRules;

  /** Rules that require user confirmation before specific tools run. */
  alwaysAskRules: PermissionRules;

  /**
   * When `true`, permission prompts are automatically denied (used for
   * background / headless agents that can't display a permission dialog).
   */
  shouldAvoidPermissionPrompts?: boolean;
};

/** Default permission context — all tools allowed, no restrictions. */
export const DEFAULT_PERMISSION_CONTEXT: ToolPermissionContext = {
  mode: 'default',
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
};

// ── Module augmentation for ToolExecutionContext ──────────────────────────────

declare module '@agent-type' {
  interface ToolExecutionContextExtension {
    /**
     * The permission context for the current execution environment.
     *
     * Injected by `PermissionsToolSet.onPatchToolContext`.  Available when
     * the Permissions ToolSet is registered; `undefined` otherwise.
     *
     * Tools can read this field to adapt their behaviour based on the
     * permission mode (e.g. skip destructive actions in `restricted` mode).
     */
    readonly permissionContext?: ToolPermissionContext;
  }
}
