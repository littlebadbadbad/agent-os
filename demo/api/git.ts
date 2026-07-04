// Azure DevOps Git APIs — REST 6.1-preview.1

import { adoFetch } from './client';

export interface GitRepo {
  id: string;
  name: string;
  defaultBranch?: string;
  remoteUrl?: string;
  webUrl?: string;
  project?: { id: string; name: string };
  isDisabled?: boolean;
  isFork?: boolean;
  size?: number;
  sshUrl?: string;
}

export async function fetchRepositories(
  collectionUrl: string,
  project: string,
  pat: string,
): Promise<GitRepo[]> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/git/repositories`;
  const res = await adoFetch<{ value: GitRepo[] }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

export interface GitPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: string;   // 'active' | 'abandoned' | 'completed' | 'notSet'
  createdBy?: { displayName?: string; uniqueName?: string };
  creationDate?: string;
  closedDate?: string;
  sourceRefName?: string;
  targetRefName?: string;
  mergeStatus?: string;
  isDraft?: boolean;
  reviewers?: Array<{ displayName?: string; uniqueName?: string; vote?: number }>;
  repository?: { id: string; name: string };
  url?: string;
  workItemRefs?: Array<{ id: string; url: string }>;
}

export async function fetchPullRequests(
  collectionUrl: string,
  project: string,
  pat: string,
  repoId: string,
  status?: string,   // 'active' | 'abandoned' | 'completed' | 'all'
  top?: number,
): Promise<GitPullRequest[]> {
  const params = new URLSearchParams();
  if (status) params.set('searchCriteria.status', status);
  if (top) params.set('$top', String(top));
  const qs = params.toString();
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullrequests${qs ? `?${qs}` : ''}`;
  const res = await adoFetch<{ value: GitPullRequest[] }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

export interface GitCommit {
  commitId: string;
  comment?: string;
  commentTruncated?: boolean;
  author?: { date?: string; email?: string; name?: string };
  committer?: { date?: string; email?: string; name?: string };
  remoteUrl?: string;
  url?: string;
  changeCounts?: { add?: number; edit?: number; delete?: number };
}

export interface FetchCommitsOpts {
  top?: number;
  skip?: number;
  fromDate?: string;
  toDate?: string;
  author?: string;
  itemPath?: string;
  branch?: string;
  fromCommitId?: string;
  toCommitId?: string;
}

export async function fetchCommits(
  collectionUrl: string,
  project: string,
  pat: string,
  repoId: string,
  opts?: FetchCommitsOpts,
): Promise<GitCommit[]> {
  const params = new URLSearchParams();
  if (opts?.top) params.set('$top', String(opts.top));
  if (opts?.skip) params.set('$skip', String(opts.skip));
  if (opts?.fromDate) params.set('searchCriteria.fromDate', opts.fromDate);
  if (opts?.toDate) params.set('searchCriteria.toDate', opts.toDate);
  if (opts?.author) params.set('searchCriteria.author', opts.author);
  if (opts?.itemPath) params.set('searchCriteria.itemPath', opts.itemPath);
  if (opts?.branch) params.set('searchCriteria.itemVersion.version', opts.branch);
  if (opts?.fromCommitId) params.set('searchCriteria.fromCommitId', opts.fromCommitId);
  if (opts?.toCommitId) params.set('searchCriteria.toCommitId', opts.toCommitId);
  const qs = params.toString();
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/commits${qs ? `?${qs}` : ''}`;
  const res = await adoFetch<{ value: GitCommit[] }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

export interface GitRef {
  name: string;        // e.g. refs/heads/main
  objectId: string;
  creator?: { displayName?: string; uniqueName?: string };
  url?: string;
}

/** Fetch branches (or tags) for a repository.
 *  @param filter Default is 'heads/' to get all branches. Use 'tags/' for tags.
 */
export async function fetchBranches(
  collectionUrl: string,
  project: string,
  pat: string,
  repoId: string,
  filter = 'heads/',
): Promise<GitRef[]> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/refs?filter=${encodeURIComponent(filter)}`;
  const res = await adoFetch<{ value: GitRef[] }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

// ── Git Items (file content) ──────────────────────────────────────────────────

export interface GitItem {
  objectId?: string;
  path?: string;
  isFolder?: boolean;
  content?: string;
  url?: string;
}

/**
 * Fetch the raw text content of a single file in a repository.
 * Folder paths return an empty string.
 *
 * GET /{collection}/{project}/_apis/git/repositories/{repoId}/items?path=...
 *
 * @param version      Branch name, tag, or commit SHA. Defaults to the repository default branch.
 * @param versionType  'branch' | 'commit' | 'tag' (default: 'branch')
 */
export async function fetchFileContent(
  collectionUrl: string,
  project: string,
  pat: string,
  repoId: string,
  path: string,
  version?: string,
  versionType: 'branch' | 'commit' | 'tag' = 'branch',
): Promise<string> {
  const params = new URLSearchParams({ path, includeContent: 'true' });
  if (version) {
    params.set('versionDescriptor.version', version);
    params.set('versionDescriptor.versionType', versionType);
  }
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?${params.toString()}`;
  const item = await adoFetch<GitItem>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return item.content ?? '';
}

/**
 * List all items (files + folders) under a given path in a repository.
 * Uses `recursionLevel=oneLevel` to list only the immediate children.
 *
 * GET /{collection}/{project}/_apis/git/repositories/{repoId}/items
 *   ?path=...&recursionLevel=oneLevel&includeContentMetadata=true
 */
export async function fetchItems(
  collectionUrl: string,
  project: string,
  pat: string,
  repoId: string,
  path: string,
  version?: string,
  versionType: 'branch' | 'commit' | 'tag' = 'branch',
): Promise<GitItem[]> {
  const params = new URLSearchParams({
    scopePath: path,
    recursionLevel: 'oneLevel',
    includeContentMetadata: 'true',
  });
  if (version) {
    params.set('versionDescriptor.version', version);
    params.set('versionDescriptor.versionType', versionType);
  }
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?${params.toString()}`;
  // The response is a JSON array wrapper: { value: GitItem[] }
  const res = await adoFetch<{ value?: GitItem[] } | GitItem[]>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  if (Array.isArray(res)) return res;
  const typed = res as { value?: GitItem[] };
  return typed.value ?? [];
}

// ── Pull Request Threads ──────────────────────────────────────────────────────

export interface PullRequestThreadComment {
  id?: number;
  content: string;
  /** 'unknown' | 'text' | 'codeChange' | 'system' */
  commentType?: string;
  author?: { displayName?: string; uniqueName?: string };
  publishedDate?: string;
  lastUpdatedDate?: string;
  isDeleted?: boolean;
}

export interface PullRequestThread {
  id: number;
  comments?: PullRequestThreadComment[];
  /** 'unknown' | 'active' | 'fixed' | 'wontFix' | 'closed' | 'byDesign' | 'pending' */
  status?: string;
  threadContext?: {
    filePath?: string;
    leftFileStart?: { line: number; offset: number };
    leftFileEnd?: { line: number; offset: number };
    rightFileStart?: { line: number; offset: number };
    rightFileEnd?: { line: number; offset: number };
  };
  isDeleted?: boolean;
  publishedDate?: string;
  lastUpdatedDate?: string;
}

/**
 * List all comment threads on a pull request.
 * GET /{collection}/{project}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads
 */
export async function fetchPullRequestThreads(
  collectionUrl: string,
  project: string,
  pat: string,
  repoId: string,
  pullRequestId: number,
): Promise<PullRequestThread[]> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${pullRequestId}/threads`;
  const res = await adoFetch<{ value: PullRequestThread[] }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

/**
 * Create a new comment thread on a pull request.
 * Pass `threadContext` for inline (file-level) comments.
 * POST /{collection}/{project}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads
 */
export async function createPullRequestThread(
  collectionUrl: string,
  project: string,
  pat: string,
  repoId: string,
  pullRequestId: number,
  content: string,
  status = 'active',
  threadContext?: PullRequestThread['threadContext'],
): Promise<PullRequestThread> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${pullRequestId}/threads`;
  return await adoFetch<PullRequestThread>(url, pat, {
    method: 'POST',
    body: {
      comments: [{ content, commentType: 'text' }],
      status,
      ...(threadContext ? { threadContext } : {}),
    },
    apiVersion: '6.1-preview.1',
  });
}
