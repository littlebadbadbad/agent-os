/**
 * internal-apps/file/agent/appAdapter.ts — File app adapter
 *
 * Implements FileAdapter using a pre-bound AppApiClient.
 */

import type { AppApiClient, DataAttachment } from '@agent-type';
import type {
  FileAdapter,
  ReadFileResult,
  WriteFileResult,
  StrReplaceResult,
  ReplaceAllResult,
  DeleteFileResult,
  MoveFileResult,
  ListDirResult,
  SearchFilesResult,
  WorkspaceRootResult,
} from './types';

export function createFileAppAdapter(apiClient: AppApiClient): FileAdapter {
  return {
    async readFile({ path, startLine, endLine }) {
      return apiClient.call<ReadFileResult>('readFile', { path, startLine, endLine });
    },

    async writeFile({ path, content }) {
      if (typeof content === 'object' && content.source === 'data') {
        return apiClient.call<WriteFileResult>('writeFile', {
          path,
          attachment: { source: content.source, mimeType: content.mimeType, data: content.data },
        });
      }
      return apiClient.call<WriteFileResult>('writeFile', { path, content });
    },

    async strReplace({ path, oldStr, newStr }) {
      return apiClient.call<StrReplaceResult>('strReplace', { path, oldStr, newStr });
    },

    async replaceAll({ path, oldStr, newStr }) {
      return apiClient.call<ReplaceAllResult>('replaceAll', { path, oldStr, newStr });
    },

    async deleteFile({ path }) {
      return apiClient.call<DeleteFileResult>('deleteFile', { path });
    },

    async moveFile({ from, to }) {
      return apiClient.call<MoveFileResult>('moveFile', { from, to });
    },

    async listDir({ path, depth }) {
      return apiClient.call<ListDirResult>('listDir', { path, depth });
    },

    async searchFiles({ pattern, content, maxResults, caseSensitive, contextLines, outputMode }) {
      return apiClient.call<SearchFilesResult>('searchFiles', {
        pattern, content, maxResults, caseSensitive, contextLines, outputMode,
      });
    },

    async getWorkspaceRoot() {
      return apiClient.call<WorkspaceRootResult>('getWorkspaceRoot');
    },

    async setWorkspaceRoot({ path }) {
      return apiClient.call<WorkspaceRootResult>('setWorkspaceRoot', { path });
    },
  };
}
