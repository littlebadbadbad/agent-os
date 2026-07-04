// Work item types, states, and delete operations

import { adoFetch } from './client';

export interface WorkItemTypeState {
  name: string;
  color: string;
  category: string; // 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed'
}

export interface WorkItemTypeDef {
  name: string;
  referenceName: string;
  description: string;
  color: string;
  isDisabled: boolean;
  icon?: { id?: string; url?: string };
  states?: WorkItemTypeState[];
  url?: string;
}

export async function fetchWorkItemTypes(
  collectionUrl: string,
  project: string,
  pat: string,
): Promise<WorkItemTypeDef[]> {
  // $expand=states fetches state definitions inline, avoiding per-type round-trips
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/wit/workitemtypes?$expand=states`;
  const res = await adoFetch<{ value: WorkItemTypeDef[] }>(url, pat, {
    apiVersion: '6.1-preview.2',
  });
  return res.value ?? [];
}

export async function fetchWorkItemTypeStates(
  collectionUrl: string,
  project: string,
  pat: string,
  type: string,
): Promise<WorkItemTypeState[]> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`;
  const res = await adoFetch<{ value: WorkItemTypeState[] }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

/**
 * Delete (or destroy) a work item.
 * @param destroy If true, permanently deletes without going to recycle bin.
 */
export async function deleteWorkItem(
  collectionUrl: string,
  project: string,
  pat: string,
  id: number,
  destroy = false,
): Promise<void> {
  const qs = destroy ? '?destroy=true' : '';
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}${qs}`;
  await adoFetch<unknown>(url, pat, { method: 'DELETE', apiVersion: '6.1-preview.3' });
}
