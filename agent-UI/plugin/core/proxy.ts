/**
 * agent-UI/plugin/core/proxy.ts — Super built-in "proxy" plugin API
 *
 * Typed wrappers around the proxy configuration backend API.
 * All calls go through PluginApiClient (dual HTTP/IPC transport).
 */

import { createPluginApiClient } from '../apiClient';

const client = createPluginApiClient('proxy');

export interface ProxyConfig {
  readonly enabled: boolean;
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
  await client.call('updateConfig', config as unknown as Record<string, unknown>);
}

export async function testProxyTarget(
  target?: string,
  overrides?: Partial<ProxyConfig>,
): Promise<ProxyTestResult> {
  return client.call<ProxyTestResult>('test', { target, ...overrides } as Record<string, unknown>);
}
