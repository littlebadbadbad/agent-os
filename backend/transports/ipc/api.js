/**
 * backend/transports/ipc/api.js — Demo-API IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 *
 * Each handler: receive params → call service → return result.
 * All business logic (validation, decryption, dispatch, HTTP forwarding,
 * error translation) lives in lib/services/*.js.
 *
 * Channels that already exist in other IPC modules (skills:*, sessions:*,
 * files:*) are not duplicated here — the apiTransport IPC layer maps
 * to those directly.
 */

import * as systemService from '../../services/system.js';
import { listModels } from '../../services/models.js';
import { getKeyList, saveKey, removeKey } from '../../services/api-keys.js';
import * as proxyService from '../../services/proxy.js';
import * as modelConfigService from '../../services/model-config.js';

/** @import { IpcMain } from 'electron' */

/** @param {IpcMain} ipcMain */
export function registerApiHandlers(ipcMain) {
  // ── Models ─────────────────────────────────────────────────────────────────
  ipcMain.handle('api:models:list', async (_event, { provider }) => {
    return listModels(provider);
  });

  // ── Public key ─────────────────────────────────────────────────────────────
  ipcMain.handle('api:public-key', async () => systemService.getPublicKeyInfo());

  // ── API keys ───────────────────────────────────────────────────────────────
  ipcMain.handle('api:api-keys:list', async () => getKeyList());

  ipcMain.handle('api:api-keys:save', async (_event, { providerId, encryptedKey }) => {
    return saveKey(providerId, encryptedKey);
  });

  ipcMain.handle('api:api-keys:delete', async (_event, { providerId }) => {
    return removeKey(providerId);
  });

  // ── Health ─────────────────────────────────────────────────────────────────
  ipcMain.handle('api:health', async () => systemService.checkHealth());

  // ── Proxy (delegated to services/proxy.js) ─────────────────────────────────
  ipcMain.handle('api:proxy:get', async () => ({ config: proxyService.getConfig() }));

  ipcMain.handle('api:proxy:update', async (_event, partial) => {
    return proxyService.updateConfig(partial);
  });

  ipcMain.handle('api:proxy:test', async (_event, { target, ...overrides }) => {
    const result = await proxyService.testProxyTarget(
      target,
      Object.keys(overrides).length > 0 ? overrides : undefined,
    );
    return { ok: result.ok, ms: result.ms, error: result.error };
  });

  // ── Model config (built-in + custom merge) ─────────────────────────────────
  ipcMain.handle('api:model-config:get', async () => {
    return modelConfigService.getMergedConfig();
  });

  ipcMain.handle('api:model-config:built-in', async () => {
    return modelConfigService.getBuiltInConfig();
  });

  ipcMain.handle('api:model-config:custom:get', async () => {
    return modelConfigService.getCustomConfig();
  });

  ipcMain.handle('api:model-config:custom:save', async (_event, config) => {
    modelConfigService.saveCustomConfig(config);
    return { ok: true };
  });

  ipcMain.handle('api:model-config:custom:add', async (_event, entry) => {
    modelConfigService.addCustomProvider(entry);
    return { ok: true };
  });

  ipcMain.handle('api:model-config:custom:remove', async (_event, { name }) => {
    modelConfigService.removeCustomProvider(name);
    return { ok: true };
  });

  ipcMain.handle('api:model-config:custom:update', async (_event, { name, entry }) => {
    modelConfigService.updateCustomProvider(name, entry);
    return { ok: true };
  });
}
