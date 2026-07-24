import type { DataAttachment } from '@agent-type';

/** Maximum file size accepted for inline (base64) attachments: 20 MB. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * MIME types that are accepted by the file picker.
 * Vendors vary in support; the formatters in `messages.ts` handle encoding.
 */
export const ACCEPTED_MIME_TYPES = [
  // Images (all major providers)
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  // Audio (Qwen, GLM-Realtime, doubao audio models)
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  // Video (Doubao vision, GLM multimodal)
  'video/mp4',
  'video/webm',
  'video/ogg',
].join(',');

export function mimeToKind(mimeType: string): DataAttachment['kind'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

export async function fileToDataAttachment(file: File): Promise<DataAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // dataUrl format: "data:<mimeType>;base64,<data>"
      const base64 = dataUrl.split(',')[1] ?? '';
      resolve({
        source: 'data',
        kind: mimeToKind(file.type),
        mimeType: file.type || 'application/octet-stream',
        data: base64,
        name: file.name,
        size: file.size,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
