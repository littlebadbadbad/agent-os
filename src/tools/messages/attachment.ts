import type { Attachment, DataAttachment, UrlAttachment } from '@agent-type';

export function isDataAttachment(a: Attachment): a is DataAttachment {
  return a.source === 'data';
}

export function isUrlAttachment(a: Attachment): a is UrlAttachment {
  return a.source === 'url';
}
