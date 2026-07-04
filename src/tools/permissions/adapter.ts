/**
 * PermissionsAdapter — the external interface for custom permission logic.
 *
 * **Pattern:** adapter (same as `UpgradeAdapter`, `UserInputAdapter`).
 *
 * The `PermissionsToolSet` delegates all permission decisions to the adapter
 * when one is provided.  When no adapter is supplied, the ToolSet uses the
 * declarative rule-based pipeline (`alwaysAllowRules` / `alwaysDenyRules` /
 * `alwaysAskRules`) and defaults to `allow` for everything else.
 *
 * **Fallback chain for `ask` results:**
 * 1. `execCtx.requestUserInput(...)` — the UserInputToolSet's interactive prompt.
 * 2. `adapter.confirm(...)` — the adapter's own headless fallback.
 * 3. Auto-deny — when neither is available (fail closed).
 *
 * @module
 */

import type { ToolSetContext } from '@agent-type';
import type { Tool } from '@agent-type';
import type { PermissionResult } from './types';

/**
 * Adapter for the permission system.
 *
 * SDK consumers provide an implementation to customise how tool permissions
 * are checked and confirmed.  When no adapter is supplied, the declarative
 * rule-based pipeline is used.
 */
export type PermissionsAdapter = {
  /**
   * Check whether a tool call should be allowed, denied, or require user
   * confirmation.
   *
   * Receives the full tool metadata (`isReadOnly`, `isDestructive`, etc.)
   * and the raw input arguments so the adapter can make context-aware
   * permission decisions.
   *
   * @param toolName  Name of the tool being called.
   * @param args      Zod-validated tool arguments.
   * @param tool      The resolved Tool instance (includes metadata fields).
   * @param ctx       ToolSet context (session/agent/conversation IDs).
   * @returns A `PermissionResult` directing the pipeline how to proceed.
   */
  checkPermission(
    toolName: string,
    args: Record<string, unknown>,
    tool: Tool,
    ctx: ToolSetContext,
  ): Promise<PermissionResult>;

  /**
   * Fallback user-confirmation prompt, used when the `UserInputToolSet` is
   * not installed (headless / SDK mode).
   *
   * Called when the permission check returns `{ behavior: 'ask' }` and
   * `execCtx.requestUserInput` is unavailable.
   *
   * @param message  The confirmation message to show the user.
   * @returns `true`  — user allowed the action.
   *          `false` — user denied the action.
   *          `null`  — user cancelled / unavailable (treated as deny).
   */
  confirm?(message: string): Promise<boolean | null>;
};
