// Work item comments — REST API 6.1-preview.3

import { adoFetch } from './client';

export interface WorkItemComment {
  id: number;
  text: string;
  createdBy?: { displayName?: string; uniqueName?: string };
  createdDate?: string;
  modifiedBy?: { displayName?: string; uniqueName?: string };
  modifiedDate?: string;
  url?: string;
}

export async function fetchWorkItemComments(
  collectionUrl: string,
  project: string,
  pat: string,
  id: number,
  top?: number,
): Promise<WorkItemComment[]> {
  const qs = top ? `?$top=${top}` : '';
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments${qs}`;
  const res = await adoFetch<{ comments: WorkItemComment[]; totalCount?: number }>(url, pat, {
    apiVersion: '6.1-preview.3',
  });
  return res.comments ?? [];
}

export async function addWorkItemComment(
  collectionUrl: string,
  project: string,
  pat: string,
  id: number,
  text: string,
): Promise<WorkItemComment> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments`;
  return await adoFetch<WorkItemComment>(url, pat, {
    method: 'POST',
    body: { text },
    apiVersion: '6.1-preview.3',
  });
}
