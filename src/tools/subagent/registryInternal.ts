/**
 * Internal types shared across the sub-agent registry sub-modules.
 *
 * Centralises the internal data structures and dependency interfaces so that
 * `registrySnapshot.ts`, `registryLifecycle.ts`, and `registryExecution.ts`
 * can import from here without creating circular dependencies.
 */

import type { ToolSet, ToolSetContext, AgentHandler } from '@agent-type';
import type { Tool } from '@agent-type';
import type { ConversationHandle } from './registryConversation';
import type { SystemPromptCache } from '../prompts/section';

// ── Internal entry ────────────────────────────────────────────────────────────

/** Internal data for a sub-agent entry. */
export type InternalEntry = {
  name: string;
  description: string;
  systemPrompt: string | undefined;
  toolNames: string[];
  maxTurns: number;
  parent: string;
  createdAt: string;
  activeConversationId: string;
  conversations: Map<string, ConversationHandle>;
  /** Per-agent prompt-section cache — shared across all conversations. */
  sectionCache: SystemPromptCache;
};

// ── Factory options ──────────────────────────────────────────────────────────

/** Options for `createSubAgentRegistry`. */
export type CreateSubAgentRegistryOptions = {
  /**
   * Lazy getter for ToolSets whose session lifecycle hooks run once per agent
   * (not per conversation).  Using a getter ensures ToolSets
   * registered after registry creation are still visible at send time.
   */
  getToolSets?: () => readonly ToolSet[];
  /**
   * The root session ID this registry belongs to.
   * Used to construct the per-agent key: `"${sessionId}:${agentName}"`.
   */
  sessionId: string;
  /**
   * Lazy tool pool getter — called each time tools need resolving.
   * Using a getter ensures that tools added after registry creation are visible.
   */
  toolPool: () => ReadonlyMap<string, Tool>;
  /**
   * Human-readable label for this registry (e.g. "async-agent", "stream-agent").
   * UI layers use this to differentiate registries when multiple are present.
   */
  label?: string;
  /**
   * Lazy getter for the LLM handler used by all sub-agents created through this
   * registry.  A getter (rather than a direct reference) lets the registry be
   * constructed before the parent agent is fully attached — the handler is only
   * resolved at the first sub-agent turn, by which time `onAttach` has fired.
   */
  handler: AgentHandler;
};

// ── Shared dependency bag ─────────────────────────────────────────────────────

/**
 * Shared dependencies resolved from the registry factory closure.
 *
 * Every sub-module factory receives this single object, eliminating
 * repetitive parameter lists while keeping dependencies explicit.
 */
export type RegistryDeps = {
  subCtx: (agentName: string, conversationId: string) => ToolSetContext;
  resolveToolSets: () => readonly ToolSet[];
  resolveTools: (toolNames: readonly string[]) => Tool[];
  handler: AgentHandler;
};
