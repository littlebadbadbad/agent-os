/**
 * agent-type/ipc-channels.ts — Canonical registry of all IPC channel names
 *
 * This file serves as the single source of truth for every IPC channel name
 * used between the Electron renderer and main process.  Each adapter file and
 * transport layer should import from here rather than hard-coding string
 * literals.
 *
 * ## Usage
 *
 * ```ts
 * import { type IpcChannel, typedInvoke } from '@agent-type/ipc-channels';
 *
 * // Type-safe channel name — typos are caught at compile time:
 * const channels = window.electronAPI;
 * typedInvoke(channels.invoke.bind(channels), 'tools:list');
 * ```
 *
 * ## Adding a channel
 *
 * 1. Add the literal to the `IpcChannel` union below.
 * 2. Update the corresponding IPC handler in `electron/main.ts`.
 * 3. If the channel is route-based, update the ROUTES table in
 *    `agent-UI/transport/apiTransport.ts`.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Union of every known IPC channel name
// ═══════════════════════════════════════════════════════════════════════════════

export type IpcChannel =
  // ── Chat ──
  | 'chat:async'
  | 'chat:stream:start'
  | 'chat:stream:stop'
  // ── App lifecycle ──
  | 'app:requestFlush'
  | 'app:flushComplete'
  // ── Health ──
  | 'health:check'
  // ── Public key ──
  | 'publicKey:get'
  // ── Broker API ──
  | 'api:proxy:get'
  | 'api:proxy:update'
  | 'api:proxy:test'
  | 'api:models:list'
  | 'api:model-config:get'
  | 'api:model-config:built-in'
  | 'api:model-config:custom:get'
  | 'api:model-config:custom:save'
  | 'api:model-config:custom:add'
  | 'api:model-config:custom:remove'
  | 'api:model-config:custom:update'
  | 'api:api-keys:list'
  | 'api:api-keys:save'
  | 'api:api-keys:delete'
  | 'api:ado-proxy:call'
  | 'api:ado-proxy:upload'
  // ── Sessions ──
  | 'sessions:load'
  | 'sessions:save'
  // ── Browser ──
  | 'browser:list'
  | 'browser:create'
  | 'browser:remove'
  | 'browser:navigate'
  | 'browser:evaluate'
  | 'browser:readOutput'
  | 'browser:snapshot'
  | 'browser:screenshotData'
  | 'browser:wait'
  | 'browser:setLaunchConfig'
  | 'browser:switchTab'
  | 'browser:networkRequests'
  | 'browser:clearNetworkRequests'
  // ═══════════════════════════════════════════════════════════════════════════════
  // Plugin IPC channels (git, file, tools) are now handled via the plugin router
  // as plugin:<pluginId>:<method> — see plugin-router.js.
  // The typed IpcChannel union above covers only built-in non-plugin channels.

// ═══════════════════════════════════════════════════════════════════════════════
// Type-safe invoke helper
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type-safe wrapper around `electronAPI.invoke()`.
 *
 * Constrains the channel name to known values from the canonical {@link IpcChannel}
 * union.  Typos in channel names are caught at compile time.
 *
 * @param invokeFn — `electronAPI.invoke` (or a bound reference to it)
 * @param channel  — A known IPC channel name
 * @param params   — Optional payload sent to the main process
 * @returns The response from the main process (untyped — cast at the call site)
 *
 * @example
 * ```ts
 * import { typedInvoke } from '@agent-type/ipc-channels';
 * const api = window.electronAPI;
 * const result = await typedInvoke(api.invoke.bind(api), 'health:check');
 * ```
 */
export function typedInvoke(
  invokeFn: (channel: string, params?: unknown) => Promise<unknown>,
  channel: IpcChannel,
  params?: unknown,
): Promise<unknown> {
  return invokeFn(channel, params);
}
