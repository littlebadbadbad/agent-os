// Azure DevOps Build / Pipeline APIs — REST 6.1-preview.7

import { adoFetch } from './client';

export interface BuildDefinitionRef {
  id: number;
  name: string;
  path: string;
  type: string;             // 'build' | 'xaml'
  queueStatus: string;      // 'enabled' | 'paused' | 'disabled'
  revision: number;
  createdDate?: string;
  url?: string;
  authoredBy?: { displayName?: string; uniqueName?: string };
  latestBuild?: { id: number; buildNumber?: string; status?: string; result?: string };
}

export interface Build {
  id: number;
  buildNumber: string;
  status: string;     // 'inProgress' | 'completed' | 'cancelling' | 'postponed' | 'notStarted' | 'none'
  result?: string;    // 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled' | 'none'
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  sourceBranch?: string;
  sourceVersion?: string;
  reason?: string;
  requestedBy?: { displayName?: string; uniqueName?: string };
  requestedFor?: { displayName?: string; uniqueName?: string };
  definition?: { id: number; name: string; path?: string };
  project?: { id: string; name: string };
  repository?: { id: string; name: string; type?: string };
  tags?: string[];
  url?: string;
}

export interface FetchBuildsOpts {
  definitionIds?: number[];
  statusFilter?: string;
  resultFilter?: string;
  branchName?: string;
  requestedFor?: string;
  minTime?: string;
  maxTime?: string;
  top?: number;
}

export async function fetchBuildDefinitions(
  collectionUrl: string,
  project: string,
  pat: string,
  name?: string,
  top?: number,
): Promise<BuildDefinitionRef[]> {
  const params = new URLSearchParams();
  // ADO name filter is exact-match only; wrap in wildcards for contains-search
  if (name) params.set('name', `*${name}*`);
  if (top) params.set('$top', String(top));
  const qs = params.toString();
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/build/definitions${qs ? `?${qs}` : ''}`;
  const res = await adoFetch<{ value: BuildDefinitionRef[] }>(url, pat, {
    apiVersion: '6.0',
  });
  return res.value ?? [];
}

export async function fetchBuilds(
  collectionUrl: string,
  project: string,
  pat: string,
  opts?: FetchBuildsOpts,
): Promise<Build[]> {
  const params = new URLSearchParams();
  if (opts?.definitionIds?.length) params.set('definitions', opts.definitionIds.join(','));
  if (opts?.statusFilter) params.set('statusFilter', opts.statusFilter);
  if (opts?.resultFilter) params.set('resultFilter', opts.resultFilter);
  if (opts?.branchName) params.set('branchName', opts.branchName);
  if (opts?.requestedFor) params.set('requestedFor', opts.requestedFor);
  if (opts?.minTime) params.set('minTime', opts.minTime);
  if (opts?.maxTime) params.set('maxTime', opts.maxTime);
  if (opts?.top) params.set('$top', String(opts.top));
  const qs = params.toString();
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/build/builds${qs ? `?${qs}` : ''}`;
  const res = await adoFetch<{ value: Build[] }>(url, pat, {
    apiVersion: '6.0',
  });
  return res.value ?? [];
}

export async function queueBuild(
  collectionUrl: string,
  project: string,
  pat: string,
  definitionId: number,
  branch?: string,
  parameters?: string,
): Promise<Build> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/build/builds`;
  return await adoFetch<Build>(url, pat, {
    method: 'POST',
    body: {
      definition: { id: definitionId },
      ...(branch ? { sourceBranch: branch } : {}),
      ...(parameters ? { parameters } : {}),
    },
    apiVersion: '6.0',
  });
}

// ── Build Definition Detail (for queue-time parameters) ─────────────────────

export interface BuildDefinitionVariable {
  /** Whether the value can be overridden at queue time */
  allowOverride: boolean;
  /** Whether the value is a secret (should be masked) */
  isSecret: boolean;
  /** The current / default value */
  value: string;
}

export interface BuildDefinitionDetail {
  id: number;
  name: string;
  path: string;
  variables: Record<string, BuildDefinitionVariable>;
  repository?: { defaultBranch?: string };
}

/**
 * Fetch the full build definition including its variables.
 * GET /{collection}/{project}/_apis/build/definitions/{definitionId}
 */
export async function fetchBuildDefinitionDetail(
  collectionUrl: string,
  project: string,
  pat: string,
  definitionId: number,
): Promise<BuildDefinitionDetail> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/build/definitions/${definitionId}`;
  return await adoFetch<BuildDefinitionDetail>(url, pat, { apiVersion: '6.0' });
}

export interface BuildLogRef {
  id: number;
  type: string;
  url: string;
}

export async function fetchBuildLogs(
  collectionUrl: string,
  project: string,
  pat: string,
  buildId: number,
): Promise<BuildLogRef[]> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/build/builds/${buildId}/logs`;
  const res = await adoFetch<{ value: BuildLogRef[] }>(url, pat, {
    apiVersion: '6.1-preview.2',
  });
  return res.value ?? [];
}

// ── Build Artifacts ───────────────────────────────────────────────────────────

export interface BuildArtifact {
  id: number;
  name: string;
  resource: {
    type?: string;
    url?: string;
    downloadUrl?: string;
    properties?: Record<string, string>;
  };
}

/**
 * List all artifacts produced by a specific build.
 * GET /{collection}/{project}/_apis/build/builds/{buildId}/artifacts
 */
export async function fetchBuildArtifacts(
  collectionUrl: string,
  project: string,
  pat: string,
  buildId: number,
): Promise<BuildArtifact[]> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/build/builds/${buildId}/artifacts`;
  const res = await adoFetch<{ value: BuildArtifact[] }>(url, pat, {
    apiVersion: '6.1-preview.5',
  });
  return res.value ?? [];
}
