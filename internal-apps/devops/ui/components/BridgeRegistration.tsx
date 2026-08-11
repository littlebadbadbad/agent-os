/**
 * internal-apps/devops/ui/components/BridgeRegistration.tsx
 *
 * Registers global bridge handlers so agent tools can read/set DevOps state
 * through the shared DevOpsBridge object.
 *
 * Mounted once inside DevOpsProvider. Registers:
 *   - 'devops.state'   — snapshot of the current DevOpsState
 *   - 'devops.dispatch' — dispatches a DevOpsAction to the store
 */

import { useEffect } from 'react';
import type { DevOpsState, DevOpsAction } from '../store/devopsStore';
import { useDevOps, globalDevOps } from '../store/devopsStore';
import type { DevOpsBridge } from '../types';

export function BridgeRegistration(): null {
  const { dispatch } = useDevOps();

  useEffect(() => {
    const host = window.__UAP_APP_HOST__;
    if (!host) return;

    const bridge = host.bridge;

    // Register the global DevOps state snapshot (reads from globalDevOps ref)
    bridge.registerHandler('devops.state', () => globalDevOps.state);

    // Register the dispatch action
    bridge.registerHandler('devops.dispatch', (action: DevOpsAction) => {
      dispatch(action);
    });

    return () => {
      bridge.unregisterHandler('devops.state');
      bridge.unregisterHandler('devops.dispatch');
    };
  }, [dispatch]);

  return null;
}
