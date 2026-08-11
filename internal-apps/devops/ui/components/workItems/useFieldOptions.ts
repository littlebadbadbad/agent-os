/**
 * useFieldOptions.ts
 * ──────────────────
 * React hook that lazily fetches and caches the allowed-values list for a
 * single ADO field within a given work-item type.
 *
 * Strategy
 * ────────
 * - Only fires the API call when the field actually has a remote picklist
 *   (as decided by `fieldNeedsRemoteOptions`).
 * - Results are stored in a module-level cache keyed by
 *   `{collectionUrl}|{project}|{workItemType}|{fieldRef}` so that switching
 *   between create/edit forms for the same project reuses already-fetched data.
 * - The hook returns `{ options, loading }`.  An empty `options` array means
 *   "no constraint" — the caller should fall back to a plain text input.
 */

import { useState, useEffect, useRef } from 'react';
import type { WorkItemFieldDef } from '../../api/types';
import { fetchFieldAllowedValues } from '../../api';
import { fieldNeedsRemoteOptions } from './fieldConfig';

// Module-level cache — survives across renders & component mounts
const optionsCache = new Map<string, string[]>();

function cacheKey(
  collectionUrl: string,
  project: string,
  workItemType: string,
  fieldRef: string,
): string {
  return `${collectionUrl}|${project}|${workItemType}|${fieldRef}`;
}

export interface FieldOptionsResult {
  options: string[];
  loading: boolean;
}

/**
 * @param collectionUrl   ADO collection root URL
 * @param project         Project name
 * @param pat             Personal access token
 * @param workItemType    Work-item type name (e.g. "Bug", "Task")
 * @param field           Field definition from fetchWorkItemFields
 * @param members         Project member display names — used as fallback options
 *                        for identity fields without a server-side list
 */
export function useFieldOptions(
  collectionUrl: string,
  project: string,
  pat: string,
  workItemType: string,
  field: WorkItemFieldDef,
  members: string[] = [],
): FieldOptionsResult {
  // For identity fields we don't hit the remote options endpoint; just use members.
  const isIdentity = field.isIdentity || field.type === 'identity';

  const key = cacheKey(collectionUrl, project, workItemType, field.referenceName);
  const cached = optionsCache.get(key);

  const [options, setOptions] = useState<string[]>(cached ?? (isIdentity ? members : []));
  const [loading, setLoading] = useState<boolean>(false);

  // Keep a stable ref so the async callback can check if still mounted
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // Identity fields — options = members list, no remote call needed
    if (isIdentity) {
      setOptions(members);
      return;
    }

    if (!fieldNeedsRemoteOptions(field)) return;
    if (!workItemType) return;

    // Serve from cache if available
    const hit = optionsCache.get(key);
    if (hit !== undefined) {
      setOptions(hit);
      return;
    }

    // Fetch from ADO
    setLoading(true);
    fetchFieldAllowedValues(collectionUrl, project, pat, workItemType, field.referenceName)
      .then((values) => {
        optionsCache.set(key, values);
        if (mountedRef.current) setOptions(values);
      })
      .catch(() => {
        if (mountedRef.current) setOptions([]);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionUrl, project, workItemType, field.referenceName]);

  return { options, loading };
}
