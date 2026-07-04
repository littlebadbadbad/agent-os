/**
 * Prompt primitives for the Sub-Agent ToolSet.
 *
 * Includes a delegation decision framework that teaches the model WHEN and WHY
 * to delegate, not just that the tool exists.
 */

import type { SectionId } from '@agent-type';

export const SUBAGENT_SECTION_ID: SectionId = 'subagent';

// ── Delegation decision framework ─────────────────────────────────────────────

export const SUBAGENT_DECISION_FRAMEWORK = `## Sub-Agents

**The one question:** Will you need this task's raw output in your own context afterward?
- **No** → use \`delegate_*_task\` (fires-and-forgets; sub-agent keeps its own context)
- **Yes** → do it yourself (you need to read and reason over the result)

**Never delegate understanding.** Don't write "research X, then I'll implement it" — if you need to understand X to write the code, do the research yourself. Delegate only when a summary or final answer is enough.

**Brief the agent like a smart colleague:** state the goal, what you've already ruled out, and scope (what's in / out). Skip pleasantries.

**Parallel dispatch:** you can fire multiple delegate calls in one turn for independent tasks.`;

// ── delegate_task tool description ────────────────────────────────────────────

export const DELEGATE_TASK_DESCRIPTION =
  'Run a self-contained task in an ephemeral sub-agent and return its final answer. ' +
  'Use when you will NOT need the intermediate tool outputs in your own context — only the result. ' +
  'Provide task (the goal) and optional context (what you already know / have ruled out). ' +
  'The sub-agent runs its full agent loop and returns a plain-text summary. ' +
  'Self-contained only: the sub-agent cannot read variables or state from this conversation.';
