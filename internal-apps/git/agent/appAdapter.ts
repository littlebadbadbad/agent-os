/**
 * internal-apps/git/agent/appAdapter.ts — Git app adapter
 *
 * Implements GitAdapter using a pre-bound AppApiClient.
 * Delegates all calls to the backend via host.apiClient.call().
 */

import type { AppApiClient } from '@agent-type';
import type {
  GitAdapter,
  GitStatusResult,
  GitDiffResult,
  GitLogEntry,
  GitCommitResult,
} from './types';

export function createGitAppAdapter(apiClient: AppApiClient): GitAdapter {
  return {
    status() {
      return apiClient.call<GitStatusResult>('status');
    },

    diff({ staged = false, paths = [] } = {}) {
      return apiClient.call<GitDiffResult>('diff', { staged, paths });
    },

    log(limit = 10) {
      return apiClient.call<{ entries: GitLogEntry[] }>('log', { limit });
    },

    stage(paths) {
      return apiClient.call<{ staged: string[] }>('stage', { paths: paths ?? [] });
    },

    unstage(paths) {
      return apiClient.call<{ unstaged: string[] }>('unstage', { paths: paths ?? [] });
    },

    commit(message) {
      return apiClient.call<GitCommitResult>('commit', { message });
    },

    discard(paths) {
      return apiClient.call<{ discarded: string[] }>('discard', { paths });
    },
  };
}
