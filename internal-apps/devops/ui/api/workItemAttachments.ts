// Work item attachment APIs — REST 6.1-preview.3

import { adoFetch } from './client';

export interface WorkItemAttachment {
  id: string;
  url: string;
  fileName?: string;
  createdDate?: string;
  uploadFinished?: boolean;
}

/**
 * Upload a file and register it as an ADO attachment.
 * Returns the attachment descriptor (including the url needed to link it to a work item).
 *
 * POST /_apis/wit/attachments?fileName={fileName}
 *
 * @param content Raw file content — pass a string for text files, ArrayBuffer for binary.
 */
export async function uploadAttachment(
  collectionUrl: string,
  pat: string,
  fileName: string,
  content: string | ArrayBuffer,
): Promise<WorkItemAttachment> {
  const url = `${collectionUrl}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}`;
  const isText = typeof content === 'string';
  return await adoFetch<WorkItemAttachment>(url, pat, {
    method: 'POST',
    rawBody: content as BodyInit,
    contentType: isText ? 'text/plain; charset=utf-8' : 'application/octet-stream',
    apiVersion: '6.1-preview.3',
  });
}

/**
 * Associate an already-uploaded attachment with a work item via the ADO relations API.
 *
 * PATCH /{collection}/{project}/_apis/wit/workitems/{workItemId}
 *
 * @param attachmentUrl The `url` field returned by uploadAttachment.
 * @param comment       Optional comment shown alongside the attachment.
 */
export async function addAttachmentToWorkItem(
  collectionUrl: string,
  project: string,
  pat: string,
  workItemId: number,
  attachmentUrl: string,
  comment?: string,
): Promise<void> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemId}`;
  await adoFetch<unknown>(url, pat, {
    method: 'PATCH',
    body: [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url: attachmentUrl,
          attributes: { comment: comment ?? '' },
        },
      },
    ],
    contentType: 'application/json-patch+json',
    apiVersion: '6.1-preview.3',
  });
}
