/**
 * debugBridge.ts — exposes the netLog store on `window` in debug builds only,
 * so the console (or Playwright) can inject synthetic entries and exercise the
 * panel without a live backend. Imported exclusively by NetDebugApp, which is
 * reached through the native-app registry (dev builds only).
 */

import { netLog } from '../../store/netLog';
import { IS_DEBUG } from '../../env';

declare global {
  interface Window {
    /** Debug-only handle to the network recorder (see debugBridge.ts). */
    __netLog?: typeof netLog;
  }
}

let installed = false;

export function installNetDebugBridge(): void {
  if (installed || !IS_DEBUG || typeof window === 'undefined') return;
  installed = true;
  window.__netLog = netLog;
}
