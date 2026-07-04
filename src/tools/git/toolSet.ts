import type { ToolSet } from '@agent-type';
import type { GitAdapter } from './adapter';
import { createGitTools } from './tools';

export function createGitToolSet(adapter: GitAdapter): ToolSet {
  const { tools, getSystemPrompt } = createGitTools(adapter);

  return {
    name: 'git',
    description: 'Git status, diff, log, stage, unstage, commit, and discard operations',
    coreTools: ['git_status', 'git_diff', 'git_stage', 'git_commit'],
    tools,
    onGetSystemPrompt: () => getSystemPrompt(),
  };
}
