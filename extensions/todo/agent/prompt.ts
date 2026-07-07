/**
 * extensions/todo/agent/prompt.ts — System-prompt section and tool descriptions
 *
 * Moved from src/tools/todo/prompt.ts.
 */

import type { TodoItem } from './types';
import type { SectionId } from '@agent-type';

// ── Section ID ────────────────────────────────────────────────────────────────

export const SECTION_ID: SectionId = 'task_tracking';

// ── Tool descriptions ─────────────────────────────────────────────────────────

/**
 * Rich description for the `todo_write` tool.
 *
 * Structured as: summary → when to use → when NOT to use → behavior → examples.
 */
export const TODO_WRITE_DESCRIPTION =
  'Replace the complete task list. Exactly one task may have status "in-progress" — returns an error otherwise.\n' +
  '\n' +
  'When to use:\n' +
  '- Complex multi-step tasks (3+ distinct steps)\n' +
  '- User explicitly requests a task list\n' +
  '- User provides multiple items to be done\n' +
  '- After receiving new instructions — immediately capture as tasks\n' +
  '- Before starting a task — mark it in-progress first\n' +
  '- After completing — mark done and add any follow-up tasks\n' +
  '\n' +
  'When NOT to use:\n' +
  '- Single, straightforward tasks that fit in one step\n' +
  '- Purely conversational or informational requests\n' +
  '- Tasks that can be completed in 1-2 direct tool calls\n' +
  '\n' +
  'Behavior:\n' +
  '- Include ALL tasks, not just changes — this is a full replacement\n' +
  '- Reuse the same task ID when updating a task (not a new one each time)\n' +
  '- Add sub-tasks as discovered during implementation\n' +
  '- Mark tasks completed immediately when done, never batch\n';

/**
 * Rich description for the `todo_read` tool.
 */
export const TODO_READ_DESCRIPTION =
  'Return the current task list.\n' +
  '\n' +
  'Use to check progress, review remaining tasks, or verify what has been completed.\n' +
  'Returns all tasks with their current status. Returns an empty list when no tasks exist.\n' +
  'No parameters needed — the current session\'s task list is always returned.\n';

/**
 * Rich description for the `TodoItem` parameter schema (embedded in tool params).
 */
export const TODO_ITEM_DESCRIPTION =
  'A single task entry. id must be unique (reuse when updating). ' +
  'status: not-started | in-progress | completed | blocked. ' +
  'Exactly one task may be in-progress at any time. ' +
  'Only set priority when it differs from the default.';

// ── System-prompt section ─────────────────────────────────────────────────────

/**
 * Build the system prompt section for task tracking.
 *
 * When items exist, include a concise snapshot of current state.
 * When no items exist, provide just the guidance so the AI knows
 * the tool is available and how to use it.
 *
 * @returns The section text, or `undefined` to skip (never skips for task_tracking).
 */
export function buildTaskTrackingSectionContent(
  items: readonly TodoItem[] | undefined,
): string {
  const guidance =
    '## Task Tracking\n' +
    'Use todo_write before starting multi-step work: decompose first, mark one task ' +
    'in-progress at a time, complete immediately when done — never batch. ' +
    'Add sub-tasks as discovered.';

  if (!items?.length) return guidance;

  const active = items.filter((t) => t.status === 'in-progress');
  const pending = items.filter((t) => t.status === 'not-started');
  const blocked = items.filter((t) => t.status === 'blocked');

  const taskParts: string[] = [];
  for (const t of active) taskParts.push(`(${t.id}) in-progress: ${t.title}`);
  for (const t of blocked) taskParts.push(`(${t.id}) blocked: ${t.title}`);
  for (const t of pending) taskParts.push(`(${t.id}) pending: ${t.title}`);

  if (taskParts.length === 0) return guidance;
  return `${guidance}\n[Current tasks: ${taskParts.join(' | ')}]`;
}
