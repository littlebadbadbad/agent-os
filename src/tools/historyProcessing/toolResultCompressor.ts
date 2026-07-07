/**
 * Tool-Result Compressor ToolSet
 *
 * Proactively compresses old tool-result messages in the conversation history
 * after every turn — analogous to Claude Code's `microcompactMessages()` which
 * runs before every API call.
 *
 * ### How it works
 * After each LLM turn, `onAfterTurn` scans the history for `ToolResultMessage`
 * objects (role: 'tool') whose tool name is in the **compactable set**.  It
 * keeps only the `keepRecentResults` most recent results per tool name and
 * replaces the content of older ones with a compact cleared-marker string.
 *
 * This ensures accumulated tool output from file reads, terminal runs, searches,
 * etc. does not bloat the context window across a long session, while preserving
 * the most recent results that the model may still need.
 *
 * ### Non-compactable tools
 * Structural-state tools (`plan_*`, `experience_*`, `var_*`,
 * `*_subagent`, `send_*_message`, etc.) are intentionally excluded so that
 * their results always stay in full.  Pass `compactableToolNames` to override.
 *
 * ### DeepSeek constraint
 * `thinking` blocks in `AssistantMessage` are never touched.  They live in
 * a different message type (`role: 'assistant'`) and this ToolSet only mutates
 * `role: 'tool'` messages, so the constraint is automatically satisfied.
 */

import type { ToolSet, ToolSetContext, CompactionResult } from '@agent-type';
import type { AgentMessage, TokenUsage } from '@agent-type';
import type { AgentHandler } from '@agent-type';

// ── Default compactable tool list ─────────────────────────────────────────────

/**
 * Tool name prefixes whose results are safe to clear from old turns.
 * These are "exploration" tools — file reads, terminal runs, searches — whose
 * output is useful when fresh but becomes dead weight as context accumulates.
 */
const DEFAULT_COMPACTABLE_PREFIXES: readonly string[] = [
  'terminal_',
  'browser_',
  'git_',
  'memory_',      // memory_recall, memory_history_list
  'file_read',
];

/**
 * Exact tool names that are compactable but don't fit a prefix pattern.
 */
const DEFAULT_COMPACTABLE_EXACT: ReadonlySet<string> = new Set([
  'read_file',
  'search',
  'grep',
  'glob',
  'web_search',
  'web_fetch',
]);

function isDefaultCompactable(toolName: string): boolean {
  if (DEFAULT_COMPACTABLE_EXACT.has(toolName)) return true;
  for (const prefix of DEFAULT_COMPACTABLE_PREFIXES) {
    if (toolName.startsWith(prefix)) return true;
  }
  return false;
}

// ── Cleared marker ────────────────────────────────────────────────────────────

const CLEARED_MARKER = '[Result cleared to save context]';

// ── Options ───────────────────────────────────────────────────────────────────

export type ToolResultCompressorOptions = {
  /**
   * Number of recent results to keep verbatim per tool name.
   * Older results beyond this count are replaced with `CLEARED_MARKER`.
   * @default 3
   */
  keepRecentResults?: number;
  /**
   * Explicit whitelist of tool names whose results may be compressed.
   * When provided, replaces the default prefix/exact matching entirely.
   * Pass an empty array to disable all compaction.
   */
  compactableToolNames?: readonly string[];
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a tool-result compressor ToolSet.
 *
 * Register early in the ToolSet list so cheap mechanical cleanup runs first,
 * reducing how often expensive LLM-based summarisation triggers.
 *
 * @example
 * ```ts
 * const compressor = createToolResultCompressorToolSet({ keepRecentResults: 3 });
 * ```
 */
export function createToolResultCompressorToolSet(
  options: ToolResultCompressorOptions = {},
): ToolSet {
  const keepRecent = options.keepRecentResults ?? 3;

  const useCustomList = options.compactableToolNames !== undefined;
  const customSet = useCustomList ? new Set(options.compactableToolNames!) : null;

  function isCompactable(toolName: string): boolean {
    if (customSet) return customSet.has(toolName);
    return isDefaultCompactable(toolName);
  }

  return {
    name: 'tool-result-compressor',
    tools: [],

    onAfterTurn(
      _ctx: ToolSetContext,
      history: AgentMessage[],
      _usage: TokenUsage | undefined,
      _signal: AbortSignal,
      _handler: AgentHandler,
    ): Promise<CompactionResult | void> {
      // ── Collect indices for each compactable tool name, in encounter order ──
      const byTool = new Map<string, number[]>();

      for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        if (msg.role === 'tool' && isCompactable(msg.name)) {
          // Skip already-cleared entries (idempotent)
          if (msg.content === CLEARED_MARKER) continue;
          let indices = byTool.get(msg.name);
          if (!indices) {
            indices = [];
            byTool.set(msg.name, indices);
          }
          indices.push(i);
        }
      }

      // ── Determine which indices to clear ──────────────────────────────────
      const toClean = new Set<number>();
      for (const [, indices] of byTool) {
        if (indices.length <= keepRecent) continue;
        // Keep the most recent `keepRecent`; clear the rest
        const cutoff = indices.length - keepRecent;
        for (let j = 0; j < cutoff; j++) {
          toClean.add(indices[j]);
        }
      }

      if (toClean.size === 0) return Promise.resolve();

      // ── Rebuild history with cleared entries ──────────────────────────────
      const newHistory: AgentMessage[] = history.map((msg, i) => {
        if (!toClean.has(i)) return msg;
        // msg.role === 'tool' at this point — spread + override content
        return { ...msg, content: CLEARED_MARKER };
      });

      return Promise.resolve({ history: newHistory });
    },
  };
}
