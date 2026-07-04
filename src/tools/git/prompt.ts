/**
 * Prompt primitives for the Git ToolSet.
 */

import type { SectionId } from '@agent-type';

export const GIT_SECTION_ID: SectionId = 'git';

export const GIT_STATUS_DESCRIPTION =
  'Get the current git status of the workspace.\n' +
  '\n' +
  'When to use:\n' +
  '- Checking which files are modified, staged, or untracked\n' +
  '- Before committing to see what will be included\n' +
  '- After operations to verify the working tree state\n' +
  '\n' +
  'Behavior:\n' +
  '- Shows modified tracked files, staged changes, and untracked files\n' +
  '- Use before commit, push, or discard operations';

export const GIT_DIFF_DESCRIPTION =
  'Get the current git diff for the workspace.\n' +
  '\n' +
  'When to use:\n' +
  '- Reviewing changes before committing\n' +
  '- Checking what changed in a specific file\n' +
  '- Verifying changes after an edit operation\n' +
  '\n' +
  'Behavior:\n' +
  '- Optionally filter by staged=true and specific file paths\n' +
  '- Shows line-level additions and deletions';

export const GIT_LOG_DESCRIPTION =
  'View recent commit history.\n' +
  '\n' +
  'When to use:\n' +
  '- Understanding recent project changes\n' +
  '- Following commit message style conventions\n' +
  '- Checking what branch you\'re on\n' +
  '\n' +
  'Behavior:\n' +
  '- Shows recent commits with hash, author, date, message\n' +
  '- Use before committing to follow project conventions';

export const GIT_ADD_DESCRIPTION =
  'Stage files for the next commit.\n' +
  '\n' +
  'When to use:\n' +
  '- Before creating a commit\n' +
  '- Adding specific files rather than all changes\n' +
  '\n' +
  'Behavior:\n' +
  '- Prefer adding specific files by path (avoid git add -A which may include sensitive files)\n' +
  '- Shows confirmation before adding files';

export const GIT_COMMIT_DESCRIPTION =
  'Create a git commit with the staged changes.\n' +
  '\n' +
  'When to use:\n' +
  '- After staging files with git_add\n' +
  '- When the user explicitly asks to commit\n' +
  '\n' +
  'Behavior:\n' +
  '- Requires a commit message\n' +
  '- Shows confirmation with the message before executing\n' +
  '- Always create NEW commits — never --amend unless explicitly requested';

export const GIT_PUSH_DESCRIPTION =
  'Push committed changes to the remote repository.\n' +
  '\n' +
  'When to use:\n' +
  '- After committing, when the user asks to push\n' +
  '- After the user explicitly requests pushing\n' +
  '\n' +
  'Behavior:\n' +
  '- Shows confirmation before pushing\n' +
  '- NEVER force push unless explicitly requested by the user';

export const GIT_DISCARD_DESCRIPTION =
  'Discard uncommitted changes in the workspace.\n' +
  '\n' +
  'When NOT to use — this is DESTRUCTIVE:\n' +
  '- Only use when explicitly asked by the user\n' +
  '- Prefer to commit or stash changes instead when possible\n' +
  '\n' +
  'Behavior:\n' +
  '- Shows destructive confirmation prompt with file list\n' +
  '- Irreversible — discarded changes cannot be recovered';

export function getGitSystemPromptSection(): string {
  return `## Git Operations

- Use git_status before any git operation to understand the working tree state
- Use git_diff to review changes before committing
- Prefer adding specific files over git add -A to avoid including sensitive files
- NEVER skip hooks (--no-verify) unless explicitly requested
- NEVER force push to main/master
- Always create NEW commits rather than amending
- Commit messages should focus on WHY, not WHAT`;
}
