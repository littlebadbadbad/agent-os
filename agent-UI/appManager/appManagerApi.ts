/**
 * agent-UI/appManager/appManagerApi.ts — App management API
 *
 * Re-exports the unified app manager API from the super built-in
 * "app-manager" app client.
 *
 * All calls go through AppApiClient (dual HTTP/IPC transport).
 */

export { appManagerApi } from '../app/core/app-manager';
export type { AppActionResponse, AppInstallResponse } from '../app/core/app-manager';
