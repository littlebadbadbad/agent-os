import { adoFetch } from './client';
import type { UserInfo } from './types';

/**
 * GET /_apis/connectionData — returns the identity of the PAT owner.
 * Works on both Azure DevOps Services and TFS / Azure DevOps Server.
 */
export async function fetchCurrentUser(serverUrl: string, pat: string): Promise<UserInfo> {
  const data = await adoFetch<{
    authenticatedUser: {
      id: string;
      providerDisplayName: string;
      /** Display name override set by the user, may be absent. */
      customDisplayName?: string;
      isActive?: boolean;
      subjectKind?: string;
      /** Login / UPN returned by some server versions. */
      uniqueName?: string;
    };
  }>(`${serverUrl}/_apis/connectionData`, pat);

  const u = data.authenticatedUser;
  return {
    id: u.id,
    displayName: u.customDisplayName ?? u.providerDisplayName,
    uniqueName: u.uniqueName ?? u.providerDisplayName,
    isActive: u.isActive ?? true,
  };
}
