// ── Plan ToolSet prompt section ───────────────────────────────────────────────
// System-prompt constants and section definition for the Plan ToolSet.
//
// Extracted from the inline `PLANNING_GUIDANCE` constant formerly in
// `toolSet.ts` so that the prompt content lives in a single, importable
// module alongside the prompt assembly pipeline.

// ── Plan guidance (system-prompt fragment) ────────────────────────────────────

/**
 * Complete plan-usage guidance injected into the system prompt when no plan
 * exists for the current session.
 *
 * Covers:
 * - When a plan is required (2+ criteria met)
 * - The markdown plan format (Goal, Approach, Steps, Verification, Out of Scope)
 * - The write → checkpoint → execute lifecycle
 * - When to re-checkpoint mid-task
 */
export const PLAN_GUIDANCE = `## Planning

Before acting on any request that meets **two or more** of these criteria, draft a plan first:
- Requires **3 or more sequential steps**
- Touches **multiple files, systems, or actors**
- Involves **irreversible actions** (delete, send, push, deploy)
- Has **ambiguous scope** or uncertain approach

### Plan Format

Call \`plan_write\` with a complete markdown document:

\`\`\`
# <Action-oriented title>

## Goal
<One sentence: the desired outcome>

## Approach
<2–4 sentences: strategy, key decisions, alternatives considered>

## Steps
1. <Verb phrase> — <what changes and why>
2. ...

## Verification
- <How to confirm the outcome is correct>

## Out of Scope
- <Explicitly excluded items>
\`\`\`

### Lifecycle
1. **Write** — Call \`plan_write\` with the full plan as a markdown document.
2. **Checkpoint** — Call \`plan_checkpoint\` to pause for user review. Do **not** execute any step before receiving approval.
3. **Rejected?** — Address every point in the feedback, rewrite the plan via \`plan_write\`, then call \`plan_checkpoint\` again.
4. **Approved?** — Execute steps in order. If scope changes significantly during execution, update the plan via \`plan_write\` and checkpoint again.

### When to Checkpoint Mid-Task
- Before any **irreversible action** (delete, push, deploy, send, modify production)
- When **new information significantly changes** the planned approach
- When the **correct next step is genuinely uncertain**`.trim();
