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

### Decision Framework

**The one question:** Will you need this task's raw output in your own context afterward?
- **No** → use \`delegate_*_task\` (fire-and-forget; sub-agent keeps its own context)
- **Yes** → do it yourself (you need to read and reason over the result)

**Never delegate understanding.** Don't write "research X, then I'll implement it" — if you need to understand X to write the code, do the research yourself. Delegate only when a summary or final answer is enough.

**Brief the agent like a smart colleague:** state the goal, what you've already ruled out, and scope (what's in / out). Skip pleasantries.

**Parallel dispatch:** you can fire multiple delegate calls in one turn for independent tasks.

### Tool Reference

**\`create_<suffix>_subagent\`** — Define a new persistent sub-agent.
- \`name\`: Short unique ID (no spaces), e.g. "researcher" or "coder-v2".
- \`description\`: What this sub-agent specializes in (≥20 chars). Shown in list output.
- \`system_prompt\` (optional): Role/persona injected into every call — e.g. "You are an expert TypeScript developer. Be concise."
- \`tool_names\`: Which pool tools this sub-agent may use. Only tools YOU have access to can be granted.
- \`max_turns\` (default 8, 1-30): Max agentic loop iterations before forced return.
Returns \`{ created, conversationId }\` — use the conversation ID with \`send_*\` immediately.

**\`update_<suffix>_subagent\`** — Edit an existing sub-agent. Omit any field to keep its current value. Pass \`""\` to clear the system prompt. Changes take effect on the next message.

**\`list_<suffix>_subagents\`** — List all sub-agents with their conversations, tool lists, maxTurns, and token usage. Each entry shows the active conversation ID and all conversation IDs — use these with \`send_*\` and \`read_*\`.

**\`delete_<suffix>_subagent\`** — Permanently remove a sub-agent and all its conversations. Irreversible.

**\`send_<suffix>_message\`** — Send a message to a sub-agent and wait for the full response. The sub-agent runs its agent loop (may call tools internally), returns the final text. History is auto-preserved — each call continues where the last left off.
- Omit \`conversation_id\` to target the active conversation.
- Pass \`attachment_handles\` to forward variable handles (\`$var:xxxx\`) as attachments (requires variable ToolSet).

**\`read_<suffix>_history\`** — Read conversation messages. Omit \`from_index\` to auto-continue from the last read position (cursor auto-advances like terminal_read). Pass \`from_index: 0\` to restart from the beginning.

**\`create_<suffix>_conversation\`** — Start a new isolated conversation thread. Becomes active immediately. Each conversation has its own message history and sub-agent-scoped state (shared across all conversations of the same sub-agent).

**\`set_<suffix>_active_conversation\`** — Switch which conversation \`send_*\` targets when no \`conversation_id\` is given. Use \`list_*\` to find conversation IDs.

**\`delete_<suffix>_conversation\`** — Remove a specific conversation. If it was active, the nearest remaining one becomes active. If it was the last conversation, a new empty one is created automatically.

**\`delegate_<suffix>_task\`** — Fire-and-forget: creates an ephemeral sub-agent, sends your task, returns the final answer, then destroys the sub-agent. The calling agent never sees intermediate tool calls — only the result.
- \`task\`: The self-contained task — state the goal, expected output format, and constraints.
- \`context\` (optional): Background knowledge — what you've already tried, ruled out, or discovered.
- \`max_turns\` (default 10, 1-20): Max agentic turns.
The ephemeral sub-agent gets all tools you have (except delegate itself). Cannot access your conversation's variables or state.`;

// ── delegate_task tool description (kept short — details in system prompt) ───

export const DELEGATE_TASK_DESCRIPTION =
  'Fire-and-forget: run a self-contained task in an ephemeral sub-agent and return its final answer. ' +
  'See "Tool Reference" in the Sub-Agents system prompt section for full docs.';
