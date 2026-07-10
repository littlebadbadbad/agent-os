/**
 * Shared utility functions for sub-agent tool definitions.
 *
 * Extracted from `metaTools.ts` so that `subAgentCrudTools.ts` and
 * `subAgentConvTools.ts` can import them without circular dependencies.
 *
 * All functions are pure — they accept their dependencies explicitly
 * rather than capturing them from a closure.
 */

import type { AgentQueryFns } from '@agent-type';
import type { SubAgentRegistry, SubAgentRegistryState } from './registryTypes';

// ── Parent context ────────────────────────────────────────────────────────────

/**
 * Build the caller's parent string from context (agentName:conversationId).
 */
export function parentFromContext(ctx: {
  agentName: string;
  conversationId: string;
}): string {
  return `${ctx.agentName}:${ctx.conversationId}`;
}

// ── Privilege escalation check ────────────────────────────────────────────────

/**
 * Returns the set of tool names the calling agent is allowed to grant.
 *
 * - Returns `null` when the caller is the main agent (no restriction applies).
 * - Returns the caller sub-agent's own `toolNames` when the caller is a
 *   registered sub-agent — preventing privilege escalation.
 */
export function getCallerToolNames(
  getState: () => SubAgentRegistryState,
  sessionId: string,
  callerAgentName: string,
): ReadonlySet<string> | null {
  const entry = getState().subAgents.find(
    (a) => a.name === callerAgentName,
  );
  return entry ? new Set(entry.toolNames) : null;
}

// ── Tool pool names ──────────────────────────────────────────────────────────

/**
 * !! DO NOT MODIFY THIS FUNCTION — OUTPUT FORMAT IS INTENTIONAL !!
 *
 * Emits ONLY tool names (no descriptions) for the "AVAILABLE TOOLS" section
 * of the create_*_subagent prompt.  Descriptions are deliberately omitted to
 * keep the prompt compact; the model does not need them at creation time.
 *
 * Returns '' when the toolset has not yet been attached to an agent (safe to
 * call during session creation before onAttach fires).
 *
 * !! AI AGENTS: do NOT change the output format or add descriptions here !!
 */
export function buildPoolNames(
  getAgent: () => AgentQueryFns,
  excludedNames: Set<string>,
): string {
  try {
    const agent = getAgent();
    if (!agent) return '';
    return agent
      .getFilteredTools()
      .filter((t) => !excludedNames.has(t.name))
      .map((t) => `- ${t.name}`)
      .join('\n');
  } catch {
    // getAgent() throws when the toolset has not been attached yet.
    return '';
  }
}

// ── Conversation ID resolution ────────────────────────────────────────────────

/**
 * Resolve the effective conversationId: explicit > active > auto-create.
 *
 * When `conversationId` is provided, it is returned directly.
 * When omitted, the sub-agent's active conversation is used.
 * If no conversations exist, a new one is auto-created.
 */
export function resolveConvId(
  registry: SubAgentRegistry,
  subagentName: string,
  conversationId?: string,
): string {
  if (conversationId) return conversationId;
  const snap = registry
    .getState()
    .subAgents.find((a) => a.name === subagentName);
  if (!snap) throw new Error(`Sub-agent "${subagentName}" not found.`);
  // Auto-create a conversation if none exist (e.g. after all were deleted then re-queried).
  const active = snap.conversations.find(
    (c) => c.conversationId === snap.activeConversationId,
  );
  if (!active) {
    const conv = registry.createConversation(subagentName);
    return conv.getState().conversationId;
  }
  return snap.activeConversationId;
}
