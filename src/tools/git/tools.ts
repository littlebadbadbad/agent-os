import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { GitAdapter } from './adapter';

const NO_USER_INPUT_ERROR = { error: 'requestUserInput not available — install UserInputToolSet' };

export function createGitTools(adapter: GitAdapter) {
  // ── git_status ─────────────────────────────────────────────────────────────

  const gitStatus = defineTool({
    name: 'git_status',
    group: 'Git',
    description: 'Show working tree status: staged, unstaged, and untracked files.',
    parameters: z.object({}),
    execute: async () => adapter.status(),
  });

  // ── git_diff ───────────────────────────────────────────────────────────────

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

  // ── git_log ────────────────────────────────────────────────────────────────

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

  // ── git_stage ──────────────────────────────────────────────────────────────

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
    execute: async ({ paths }, context) => {
      if (!context.requestUserInput) return NO_USER_INPUT_ERROR;
      const target = paths?.length ? paths.join(', ') : 'all changes (git add -A)';
      const reply = await context.requestUserInput({
        type: 'confirm',
        message: `Stage for commit: ${target}?`,
        ephemeral: true,
      });
      if (reply !== 'yes') return { status: 'cancelled' };
      return adapter.stage(paths);
    },
  });

  // ── git_unstage ────────────────────────────────────────────────────────────

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
    execute: async ({ paths }, context) => {
      if (!context.requestUserInput) return NO_USER_INPUT_ERROR;
      const target = paths?.length ? paths.join(', ') : 'all staged changes';
      const reply = await context.requestUserInput({
        type: 'confirm',
        message: `Unstage: ${target}?`,
        ephemeral: true,
      });
      if (reply !== 'yes') return { status: 'cancelled' };
      return adapter.unstage(paths);
    },
  });

  // ── git_commit ─────────────────────────────────────────────────────────────

  const gitCommit = defineTool({
    name: 'git_commit',
    group: 'Git',
    description:
      'Create a commit with the given message. ' +
      'Shows the message in a confirmation prompt before executing.',
    parameters: z.object({
      message: z.string().min(1).describe('Commit message.'),
    }),
    execute: async ({ message }, context) => {
      if (!context.requestUserInput) return NO_USER_INPUT_ERROR;
      const reply = await context.requestUserInput({
        type: 'confirm',
        message: `Commit with message:\n"${message}"\n\nProceed?`,
        ephemeral: true,
      });
      if (reply !== 'yes') return { status: 'cancelled' };
      return adapter.commit(message);
    },
  });

  // ── git_discard ────────────────────────────────────────────────────────────

  const gitDiscard = defineTool({
    name: 'git_discard',
    group: 'Git',
    description:
      '⚠️ DESTRUCTIVE — discard unstaged changes with `git restore`. ' +
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
    execute: async ({ paths }, context) => {
      if (!context.requestUserInput) return NO_USER_INPUT_ERROR;
      const reply = await context.requestUserInput({
        type: 'confirm',
        message:
          `⚠️ DESTRUCTIVE: Discard all unstaged changes in:\n${paths.join('\n')}\n\n` +
          'This cannot be undone. Proceed?',
        ephemeral: true,
      });
      if (reply !== 'yes') return { status: 'cancelled' };
      return adapter.discard(paths);
    },
  });

  const tools = [gitStatus, gitDiff, gitLog, gitStage, gitUnstage, gitCommit, gitDiscard] as const;

  function getSystemPrompt(): string {
    return [
      '## Git',
      'Use `git_status`, `git_diff`, and `git_log` for read-only inspection at any time.',
      '`git_stage`, `git_unstage`, `git_commit`, and `git_discard` require user confirmation before executing.',
      '`git_discard` is destructive — always show the affected paths clearly in the confirmation message.',
    ].join('\n');
  }

  return { tools, getSystemPrompt };
}
