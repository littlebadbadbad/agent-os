/**
 * Tests for backend/core/index.js — core plugin registry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/system.js', () => ({ register: vi.fn() }));
vi.mock('../core/proxy.js', () => ({ register: vi.fn() }));
vi.mock('../core/models.js', () => ({ register: vi.fn() }));
vi.mock('../core/model-config.js', () => ({ register: vi.fn() }));
vi.mock('../core/sessions.js', () => ({ register: vi.fn() }));
vi.mock('../core/chat.js', () => ({ register: vi.fn() }));
vi.mock('../core/api-keys.js', () => ({ register: vi.fn() }));
vi.mock('../core/plugin-manager.js', () => ({ register: vi.fn() }));

import { register as mockSystem } from '../core/system.js';
import { register as mockProxy } from '../core/proxy.js';
import { register as mockModels } from '../core/models.js';
import { register as mockModelConfig } from '../core/model-config.js';
import { register as mockSessions } from '../core/sessions.js';
import { register as mockChat } from '../core/chat.js';
import { register as mockApiKeys } from '../core/api-keys.js';
import { register as mockPluginManager } from '../core/plugin-manager.js';

describe('core/index — registerCorePlugins', () => {
  let registerCorePlugins;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../core/index.js');
    registerCorePlugins = mod.registerCorePlugins;
  });

  it('registers all 8 core plugins', () => {
    const router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const deps = { pluginScanner: {}, pluginConfigStore: {} };

    registerCorePlugins(router, deps);

    expect(mockSystem).toHaveBeenCalledWith(router);
    expect(mockProxy).toHaveBeenCalledWith(router);
    expect(mockModels).toHaveBeenCalledWith(router);
    expect(mockModelConfig).toHaveBeenCalledWith(router);
    expect(mockSessions).toHaveBeenCalledWith(router);
    expect(mockChat).toHaveBeenCalledWith(router);
    expect(mockApiKeys).toHaveBeenCalledWith(router);
    expect(mockPluginManager).toHaveBeenCalledWith(router, deps);
  });
});
