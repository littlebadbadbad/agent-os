/**
 * internal-apps/git/agent/tools.ts — Git tool definitions
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { GitAdapter } from './types';

export function createGitTools(adapter: GitAdapter) {
  const gitStatus = defineTool({
    name: 'git_status',
    group: 'Git',
    description: 'Show working tree status: staged, unstaged, and untracked files.',
    parameters: z.object({}),
    execute: async () => adapter.status(),
  });

  const gitDiff = defineTool({
    name: 'git_diff',
    group: 'Git',
    description:
      'Show changes. `staged=true` shows the staged (index vs HEAD) diff. ' +
      '`paths` limits scope to specific files.',
    parameters: z.object({
      staged: z
        .boolean()
        .optional()
        .describe('Show staged diff (index vs HEAD). Defaults to false (working tree diff).'),
      paths: z
        .array(z.string())
        .optional()
        .describe('Limit diff to these file paths. Omit for all files.'),
    }),
    execute: async ({ staged, paths }) => adapter.diff({ staged, paths }),
  });

  const gitLog = defineTool({
    name: 'git_log',
    group: 'Git',
    description: 'Show recent commit history.',
    parameters: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Maximum number of commits to return. Defaults to 10.'),
    }),
    execute: async ({ limit }) => adapter.log(limit),
  });

  const gitStage = defineTool({
    name: 'git_stage',
    group: 'Git',
    description:
      'Stage files for commit (`git add`). ' +
      'Omit `paths` or pass `[]` to stage all changes. ' +
      'Requires user confirmation before executing.',
    parameters: z.object({
      paths: z
        .array(z.string())
        .optional()
        .describe('Files to stage. Omit or pass [] to stage all changes (git add -A).'),
    }),
    execute: async ({ paths }) => adapter.stage(paths),
  });

  const gitUnstage = defineTool({
    name: 'git_unstage',
    group: 'Git',
    description:
      'Unstage files (`git restore --staged`). ' +
      'Omit `paths` or pass `[]` to unstage everything. ' +
      'Requires user confirmation before executing.',
    parameters: z.object({
      paths: z
        .array(z.string())
        .optional()
        .describe('Files to unstage. Omit or pass [] to unstage all staged changes.'),
    }),
    execute: async ({ paths }) => adapter.unstage(paths),
  });

  const gitCommit = defineTool({
    name: 'git_commit',
    group: 'Git',
    description:
      'Create a commit with the given message. ' +
      'Shows the message in a confirmation prompt before executing.',
    parameters: z.object({
      message: z.string().min(1).describe('Commit message.'),
    }),
    execute: async ({ message }) => adapter.commit(message),
  });

  const gitDiscard = defineTool({
    name: 'git_discard',
    group: 'Git',
    description:
      'DESTRUCTIVE — discard unstaged changes with `git restore`. ' +
      'Requires an explicit non-empty file list and user confirmation. ' +
      'Discarded changes cannot be recovered.',
    parameters: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .describe(
          'Files whose unstaged changes to discard. Must be non-empty — no accidental git restore .',
        ),
    }),
    execute: async ({ paths }) => adapter.discard(paths),
  });

  const tools = [gitStatus, gitDiff, gitLog, gitStage, gitUnstage, gitCommit, gitDiscard] as const;

  function getSystemPrompt(): string {
    return [
      '## Git',
      'Use `git_status`, `git_diff`, and `git_log` for read-only inspection at any time.',
      '`git_stage`, `git_unstage`, `git_commit`, and `git_discard` modify the working tree.',
      '`git_discard` is destructive — always show the affected paths clearly when calling it.',
    ].join('\n');
  }

  return { tools, getSystemPrompt };
}
