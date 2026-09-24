/**
 * useNetLog — subscribe a component to the network recorder store.
 *
 * Thin wrapper over `useSyncExternalStore` using the module-singleton
 * `netLog` store (see store/netLog.ts). Returns the current immutable
 * snapshot; consumers derive filtered/visible views from `snapshot.entries`.
 */

import { useSyncExternalStore } from 'react';
import { netLog } from '../../store/netLog';
import type { NetLogSnapshot } from '../../store/netLog';

export function useNetLog(): NetLogSnapshot {
  return useSyncExternalStore(netLog.subscribe, netLog.getSnapshot, netLog.getSnapshot);
}
