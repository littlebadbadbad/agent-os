/**
 * agent-UI/app/core/proxy.ts — Super built-in "proxy" app API
 *
 * Typed wrappers around the proxy configuration backend API.
 * All calls go through AppApiClient (dual HTTP/IPC transport).
 */

import { createAppApiClient } from '../apiClient';

const client = createAppApiClient('proxy');

export interface ProxyConfig {
  readonly protocol: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly noProxy: string;
  readonly connectTimeout: number;
}

export interface ProxyInfo {
  readonly config: ProxyConfig;
}

export interface ProxyTestResult {
  readonly ok: boolean;
  readonly ms?: number;
  readonly error?: string;
}

export async function getProxyConfig(): Promise<ProxyInfo> {
  return client.call<ProxyInfo>('getConfig');
}

export async function updateProxyConfig(config: ProxyConfig): Promise<void> {
  await client.call('updateConfig', { ...config });
}

export async function testProxyTarget(
  target?: string,
  overrides?: Partial<ProxyConfig>,
): Promise<ProxyTestResult> {
  return client.call<ProxyTestResult>('test', { target, ...overrides });
}
