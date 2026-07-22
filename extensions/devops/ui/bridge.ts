import { uiBridge } from './tools/uiBridge';
import type { DevOpsBridge } from './types';

export function populateDevopsBridge(bridge: DevOpsBridge) {
  const impl = uiBridge
  bridge.callHandler = impl.call.bind(impl);
  bridge.snapshot = impl.snapshot.bind(impl);
  bridge.isRegistered = impl.isRegistered.bind(impl);
  bridge.waitUntil = impl.waitUntil.bind(impl);
  bridge.registerHandler = impl.register.bind(impl);
  bridge.unregisterHandler = impl.unregister.bind(impl);
  return impl;
}
