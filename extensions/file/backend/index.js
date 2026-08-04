/**
 * extensions/file/backend/index.js — File backend plugin
 *
 * Registers all File API methods via host.defineApi().
 */

import * as svc from './services/files.js';

export function activate(host) {
  host.defineApi('readFile', async (params) => svc.readFile(params));
  host.defineApi('writeFile', async (params) => svc.writeFile(params));
  host.defineApi('strReplace', async (params) => svc.replaceInFile(params));
  host.defineApi('replaceAll', async (params) => svc.replaceAllInFile(params));
  host.defineApi('deleteFile', async (params) => svc.deleteFile(params));
  host.defineApi('moveFile', async (params) => svc.moveFile(params));
  host.defineApi('listDir', async (params) => svc.listDirectory(params));
  host.defineApi('searchFiles', async (params) => svc.searchFiles(params));
  host.defineApi('getWorkspaceRoot', async () => svc.getWorkspaceRootPath());
  host.defineApi('setWorkspaceRoot', async (params) => svc.setWorkspaceRootPath(params));
  host.defineApi('openWorkspace', async (params) => svc.openWorkspace(params));
  host.defineApi('browseDir', async (params) => svc.browseDirectory(params?.path));
}
