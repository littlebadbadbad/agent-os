/**
 * Permissions ToolSet — the lifecycle hook that intercepts tool execution and
 * applies permission checks.
 *
 * **Architecture:** adapter pattern (same as `UpgradeToolSet`, `UserInputToolSet`).
 *
 * ```
 * onBeforeToolExecute
 *   ├── bypass mode?        → allow unconditionally
 *   ├── adapter provided?   → adapter.checkPermission()
 *   │                        (full access to tool metadata + rules)
 *   └── no adapter?         → checkToolPermission() declarative rules
 *                              (alwaysAllow / alwaysDeny / alwaysAsk)
 *
 *   Ask result handling:
 *     execCtx.requestUserInput?    → interactive prompt
 *     ?? adapter.confirm?          → headless fallback
 *     ?? auto-deny                 → fail closed
 * ```
 *
 * @module
 */

import type { ToolSet, ToolSetContext } from '@agent-type';
import type { Tool, ToolExecutionContext } from '@agent-type';
import type { ToolResult } from '@agent-type';
import type { PermissionsAdapter } from './adapter';
import { checkToolPermission } from './pipeline';
import { DEFAULT_PERMISSION_CONTEXT } from './types';
import type { ToolPermissionContext, PermissionResult } from './types';

// ── Options ───────────────────────────────────────────────────────────────────

export type PermissionsToolSetOptions = {
  /**
   * Optional adapter for custom permission logic.
   *
   * When provided, the adapter's `checkPermission` is called for every tool
   * invocation, bypassing the declarative rule system.  The adapter has full
   * access to tool metadata and can return `'allow'`, `'deny'`, or `'ask'`.
   */
  adapter?: PermissionsAdapter;

  /**
   * Initial permission context.  Defaults to `DEFAULT_PERMISSION_CONTEXT`
   * (all tools allowed, no restrictions).
   */
  context?: ToolPermissionContext;

  /**
   * Section ID for system-prompt injection.
   * Defaults to `'permissions'` — registered in `SECTION_IDS`.
   * Set to `undefined` to skip system-prompt injection.
   */
  sectionId?: 'permissions' | undefined;
};

// ── Helper: handle an `ask` result ────────────────────────────────────────────

/**
 * Try to resolve an `ask` permission result through the available channels.
 *
 * @returns `true` if the user approved, `false` otherwise.
 */
async function resolveAsk(
  message: string,
  adapter: PermissionsAdapter | undefined,
  execCtx: ToolExecutionContext,
): Promise<boolean> {
  // 1. Interactive prompt via UserInputToolSet
  if (execCtx.requestUserInput) {
    const response = await execCtx.requestUserInput({
      type: 'confirm',
      message,
      ephemeral: true,
    });
    return response === 'yes';
  }

  // 2. Adapter fallback (headless / SDK mode)
  if (adapter?.confirm) {
    const response = await adapter.confirm(message);
    return response === true;
  }

  // 3. No channel available — fail closed
  return false;
}

/**
 * Handle a permission result: deny → return error result; ask → prompt user.
 *
 * @returns `{ allow: true }` or `{ allow: false, result }`.
 */
async function handlePermissionResult(
  result: PermissionResult,
  toolName: string,
  toolCallId: string,
  adapter: PermissionsAdapter | undefined,
  execCtx: ToolExecutionContext,
): Promise<{ allow: true } | { allow: false; result: ToolResult }> {
  if (result.behavior === 'allow') return { allow: true };

  if (result.behavior === 'deny') {
    return {
      allow: false,
      result: {
        toolCallId,
        name: toolName,
        result: `[Permission denied] ${result.message}`,
      },
    };
  }

  // behavior === 'ask'
  const approved = await resolveAsk(result.message, adapter, execCtx);
  if (approved) return { allow: true };

  return {
    allow: false,
    result: {
      toolCallId,
      name: toolName,
      result: `[Permission denied] The user did not approve the action.`,
    },
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a `PermissionsToolSet` that intercepts tool execution and applies
 * permission checks via the `onBeforeToolExecute` lifecycle hook.
 *
 * Register this ToolSet on your agent to enable permission checking.
 * Every tool call is checked before execution begins.
 *
 * **Without an adapter:** the ToolSet uses declarative rules
 * (`alwaysAllowRules`, `alwaysDenyRules`, `alwaysAskRules`) and a default
 * policy that asks for destructive tools in `default` mode, denies writes in
 * `restricted` mode, and allows everything in `bypass` mode.
 *
 * **With an adapter:** the adapter receives every tool call and can implement
 * custom permission logic, external policy servers, or custom UI prompts.
 *
 * @example
 * ```ts
 * import { createPermissionsToolSet } from './permissions';
 *
 * const agent = createAgentClient({
 *   handler,
 *   toolSets: [
 *     createPermissionsToolSet({
 *       adapter: myAdapter,
 *       context: {
 *         mode: 'default',
 *         alwaysDenyRules: { 'terminal_rm_*': 'deny' },
 *         alwaysAskRules: { 'terminal_send': 'ask' },
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export function createPermissionsToolSet(
  options?: PermissionsToolSetOptions,
): ToolSet {
  const { adapter, sectionId } = options ?? {};
  let permissionContext: ToolPermissionContext = options?.context ?? {
    ...DEFAULT_PERMISSION_CONTEXT,
  };

  return {
    name: 'permissions',
    description: 'Tool permission checking',
    sectionId: sectionId ?? ('permissions' as any),
    tools: [],

    // ── Per-tool-call hooks ────────────────────────────────────────────────

    onPatchToolContext(
      _ctx: ToolSetContext,
      _signal: AbortSignal,
    ): Partial<ToolExecutionContext> | undefined {
      return { permissionContext };
    },

    async onBeforeToolExecute(
      _srcCtx: ToolSetContext,
      toolName: string,
      tool: Tool,
      args: Record<string, unknown>,
      execCtx: ToolExecutionContext,
    ): Promise<{ allow: true } | { allow: false; result: ToolResult } | void> {
      // Bypass mode: skip all checks
      if (permissionContext.mode === 'bypass') return;

      // Permission context says skip prompts?  Auto-deny 'ask' results.
      // We still run the check so 'deny' results are respected.
      const shouldAvoid = permissionContext.shouldAvoidPermissionPrompts;

      let result: PermissionResult;

      if (adapter) {
        result = await adapter.checkPermission(toolName, args, tool, _srcCtx);
      } else {
        result = checkToolPermission(toolName, args, tool, permissionContext);
      }

      // When shouldAvoidPermissionPrompts is set, treat 'ask' as 'deny'
      if (result.behavior === 'ask' && shouldAvoid) {
        return {
          allow: false,
          result: {
            toolCallId: '',
            name: toolName,
            result: `[Permission denied] Tool requires approval but permission prompts are disabled.`,
          },
        };
      }

      return handlePermissionResult(result, toolName, '', adapter, execCtx);
    },
  };
}
