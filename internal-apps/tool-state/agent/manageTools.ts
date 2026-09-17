/**
 * `manage_tools` — the resident batch tool-enable/disable tool.
 *
 * Under the default-off model every session starts with all tools hidden;
 * this is the AI's only way to change that. It is RESIDENT (see toolMeta.ts):
 * always visible, always executable, and refused by every control surface
 * (session toggle, `manage_tools` itself, and the global store).
 *
 * The tool itself is a thin, pure definition — all state lives behind the
 * injected {@link ManageToolsApi}, implemented by the ToolSet (which owns the
 * per-scope enabled sets and the global lock). Batches are atomic: any
 * invalid name rejects the whole call so the AI can fix and retry.
 */

import { z } from 'zod';
import type { Tool, ToolExecutionContext, ToolSetContext } from '@agent-type';

/** Name of the resident management tool. */
export const MANAGE_TOOLS_NAME = 'manage_tools';

/** Outcome of one atomic batch applied to a single scope. */
export interface ManageToolsBatchResult {
  /** Tools that are enabled (visible) in this scope after the call. */
  readonly enabled: readonly string[];
  /** Tools that are disabled (hidden) in this scope after the call. */
  readonly disabled: readonly string[];
  /** Refusal reasons; non-empty means the batch was NOT applied. */
  readonly errors: readonly string[];
}

/** Capability the ToolSet injects so the tool can mutate scope state. */
export interface ManageToolsApi {
  /**
   * Validate and (atomically) apply one enable/disable batch for the scope
   * identified by `ctx`. Implementations must also notify subscribers when
   * the visible tool set changes.
   */
  batch(
    ctx: ToolSetContext,
    enable: readonly string[],
    disable: readonly string[],
  ): ManageToolsBatchResult;
}

const manageToolsSchema = z.object({
  enable: z
    .array(z.string())
    .optional()
    .describe('Tool names from the disabled-tool catalogue to enable for this session.'),
  disable: z
    .array(z.string())
    .optional()
    .describe('Tool names to disable (hide) again for this session.'),
});

/**
 * Create the `manage_tools` tool bound to a ToolSet instance.
 *
 * `ToolExecutionContext` structurally satisfies `ToolSetContext`
 * (sessionId / agentName / conversationId), so the calling agent's scope —
 * main session or sub-agent conversation — is addressed directly.
 */
export function createManageToolsTool(api: ManageToolsApi): Tool {
  const tool: Tool<typeof MANAGE_TOOLS_NAME, typeof manageToolsSchema> = {
    name: MANAGE_TOOLS_NAME,
    description:
      'Enable or disable tools for the current session (batch, atomic). ' +
      'All tools start disabled; enabled tools become callable from your next turn. ' +
      'Enable only what the current step needs. ' +
      'Returns the session\'s full enabled/disabled lists afterwards.',
    group: 'Tool State',
    parameters: manageToolsSchema,
    isReadOnly: false,
    async execute(params, ctx: ToolExecutionContext) {
      const enable = params.enable ?? [];
      const disable = params.disable ?? [];
      if (enable.length === 0 && disable.length === 0) {
        return {
          enabled: [] as readonly string[],
          disabled: [] as readonly string[],
          errors: ['Provide at least one name in `enable` or `disable`.'],
        };
      }
      const result = api.batch(
        { sessionId: ctx.sessionId, agentName: ctx.agentName, conversationId: ctx.conversationId },
        enable,
        disable,
      );
      return result;
    },
  };
  return tool;
}
