import { adoFetch } from './client';
import type { Collection, RawCollection } from './types';

/**
 * GET {serverUrl}/_apis/projectCollections
 * Lists all project collections on the server (on-premise ADO Server).
 */
export async function fetchCollections(
  serverUrl: string,
  pat: string,
): Promise<Collection[]> {
  const root = serverUrl.replace(/\/$/, '');
  const data = await adoFetch<{ value: RawCollection[] }>(
    `${root}/_apis/projectCollections`,
    pat,
  );

  return (data?.value ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    url: (c.collectionUrl ?? `${root}/${c.name}`).replace(/\/$/, ''),
    state: c.state ?? 'unknown',
  }));
}
