// Azure DevOps Release Pipeline APIs — REST 6.1-preview

import { adoFetch } from './client';

export interface ReleaseDefinitionRef {
  id: number;
  name: string;
  path: string;
  releaseNameFormat?: string;
  createdBy?: { displayName?: string; uniqueName?: string };
  createdOn?: string;
  modifiedBy?: { displayName?: string; uniqueName?: string };
  modifiedOn?: string;
  url?: string;
}

export interface ReleaseEnvironment {
  id: number;
  name: string;
  /** 'notStarted' | 'queued' | 'inProgress' | 'succeeded' | 'canceled' | 'rejected' | 'partiallySucceeded' */
  status: string;
  deploySteps?: Array<{
    id?: number;
    deploymentId?: number;
    attemptNumber?: number;
    status?: string;
    operationStatus?: string;
    lastModifiedBy?: { displayName?: string };
    lastModifiedOn?: string;
  }>;
  scheduledDeploymentTime?: string;
  queuedOn?: string;
  lastModifiedOn?: string;
  url?: string;
}

export interface Release {
  id: number;
  name: string;
  /** 'undefined' | 'draft' | 'active' | 'abandoned' */
  status: string;
  createdOn?: string;
  modifiedOn?: string;
  createdBy?: { displayName?: string; uniqueName?: string };
  modifiedBy?: { displayName?: string; uniqueName?: string };
  releaseDefinition?: { id: number; name: string; path?: string };
  environments?: ReleaseEnvironment[];
  artifacts?: Array<{
    alias?: string;
    definitionReference?: Record<string, { id?: string; name?: string }>;
  }>;
  description?: string;
  url?: string;
  webAccessUri?: string;
}

export interface FetchReleasesOpts {
  definitionId?: number;
  /** 'undefined' | 'draft' | 'active' | 'abandoned' */
  statusFilter?: string;
  createdBy?: string;
  minCreatedTime?: string;
  maxCreatedTime?: string;
  top?: number;
  /** 'none' | 'environments' | 'artifacts' | 'approvals' | 'all' */
  expand?: string;
}

/**
 * List release definitions within a project.
 * GET /{collection}/{project}/_apis/release/definitions
 */
export async function fetchReleaseDefinitions(
  collectionUrl: string,
  project: string,
  pat: string,
  name?: string,
  top?: number,
): Promise<ReleaseDefinitionRef[]> {
  const params = new URLSearchParams();
  if (name) params.set('searchText', name);
  if (top) params.set('$top', String(top));
  const qs = params.toString();
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/release/definitions${qs ? `?${qs}` : ''}`;
  const res = await adoFetch<{ value: ReleaseDefinitionRef[]; count?: number }>(url, pat, {
    apiVersion: '6.1-preview.4',
  });
  return res.value ?? [];
}

/**
 * List release records within a project.
 * GET /{collection}/{project}/_apis/release/releases
 */
export async function fetchReleases(
  collectionUrl: string,
  project: string,
  pat: string,
  opts?: FetchReleasesOpts,
): Promise<Release[]> {
  const params = new URLSearchParams();
  if (opts?.definitionId) params.set('definitionId', String(opts.definitionId));
  if (opts?.statusFilter) params.set('statusFilter', opts.statusFilter);
  if (opts?.createdBy) params.set('createdBy', opts.createdBy);
  if (opts?.minCreatedTime) params.set('minCreatedTime', opts.minCreatedTime);
  if (opts?.maxCreatedTime) params.set('maxCreatedTime', opts.maxCreatedTime);
  if (opts?.top) params.set('$top', String(opts.top));
  if (opts?.expand) params.set('$expand', opts.expand);
  const qs = params.toString();
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/release/releases${qs ? `?${qs}` : ''}`;
  const res = await adoFetch<{ value: Release[]; count?: number }>(url, pat, {
    apiVersion: '6.1-preview.8',
  });
  return res.value ?? [];
}

/**
 * Trigger a new release from a release definition.
 * POST /{collection}/{project}/_apis/release/releases
 */
export async function createRelease(
  collectionUrl: string,
  project: string,
  pat: string,
  definitionId: number,
  description?: string,
  artifacts?: Array<{ alias: string; instanceReference: { id?: string; name?: string } }>,
): Promise<Release> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/release/releases`;
  return await adoFetch<Release>(url, pat, {
    method: 'POST',
    body: {
      definitionId,
      ...(description ? { description } : {}),
      ...(artifacts ? { artifacts } : {}),
    },
    apiVersion: '6.1-preview.8',
  });
}

/**
 * Get the status and deployment details of a single release environment (stage).
 * GET /{collection}/{project}/_apis/release/releases/{releaseId}/environments/{environmentId}
 */
export async function fetchReleaseEnvironment(
  collectionUrl: string,
  project: string,
  pat: string,
  releaseId: number,
  environmentId: number,
): Promise<ReleaseEnvironment> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/release/releases/${releaseId}/environments/${environmentId}`;
  return await adoFetch<ReleaseEnvironment>(url, pat, {
    apiVersion: '6.1-preview.7',
  });
}
