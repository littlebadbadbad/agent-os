import type { DevOpsBridge } from '../../ui/types';

export function createHelpers(bridge: DevOpsBridge) {
  return {
    bridgeCall: bridge.callHandler.bind(bridge),
    bridgeSnap: bridge.snapshot.bind(bridge),
    waitForRegistered: (keys: string[], timeoutMs = 10_000) =>
      bridge.waitUntil(() => keys.every((k) => bridge.isRegistered(k)), timeoutMs, 200),
    waitForWorkItemHandlers: () =>
      bridge.waitUntil(() => bridge.isRegistered('wi.getState'), 10_000, 200),
  };
}
