// Work item revision history and updates

import { adoFetch } from './client';

export interface WorkItemFieldDelta {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface WorkItemUpdate {
  rev: number;
  id: number;
  revisedBy?: { displayName?: string; uniqueName?: string };
  revisedDate?: string;
  url?: string;
  fields?: Record<string, WorkItemFieldDelta>;
  relations?: {
    added?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
    removed?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
  };
}

export interface WorkItemRevision {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  url?: string;
}

export async function fetchWorkItemUpdates(
  collectionUrl: string,
  project: string,
  pat: string,
  id: number,
  top?: number,
): Promise<WorkItemUpdate[]> {
  const qs = top ? `?$top=${top}` : '';
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}/updates${qs}`;
  const res = await adoFetch<{ value: WorkItemUpdate[]; count: number }>(url, pat, {
    apiVersion: '6.1-preview.3',
  });
  return res.value ?? [];
}

export async function fetchWorkItemRevisions(
  collectionUrl: string,
  project: string,
  pat: string,
  id: number,
  top?: number,
): Promise<WorkItemRevision[]> {
  const qs = top ? `?$top=${top}` : '';
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}/revisions${qs}`;
  const res = await adoFetch<{ value: WorkItemRevision[]; count: number }>(url, pat, {
    apiVersion: '6.1-preview.3',
  });
  return res.value ?? [];
}
