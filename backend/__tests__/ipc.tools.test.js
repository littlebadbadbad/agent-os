/**
 * Tests for backend/transports/ipc/tools.js — Dynamic-tool IPC handlers
 *
 * Pure protocol-layer passthrough: each IPC handler calls the corresponding
 * toolService function with the incoming params and returns the result.
 *
 * Coverage:
 *   tools:list / tools:create / tools:update / tools:delete / tools:execute
 *   toolModules:list / toolModules:get / toolModules:create / toolModules:update / toolModules:delete
 *   toolDeps:list / toolDeps:install / toolDeps:remove
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Mock tool service ─────────────────────────────────────────────────────────

const mockService = vi.hoisted(() => ({
  getToolsList:    vi.fn(),
  createTool:      vi.fn(),
  updateTool:      vi.fn(),
  deleteTool:      vi.fn(),
  runTool:         vi.fn(),
  getModulesList:  vi.fn(),
  getToolModule:   vi.fn(),
  createToolModule: vi.fn(),
  updateToolModule: vi.fn(),
  deleteToolModule: vi.fn(),
  getDepsList:     vi.fn(),
  installToolDeps: vi.fn(),
  removeToolDep:   vi.fn(),
}));

vi.mock('../services/tools.js', () => mockService);

// ── Import AFTER mocks ────────────────────────────────────────────────────────

import { registerToolHandlers } from '../transports/ipc/tools.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockIpcMain() {
  const handlers = {};
  return {
    _handlers: handlers,
    handle(channel, fn) { handlers[channel] = fn; },
  };
}

function makeEvent() {
  return { sender: { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) } };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let ipcMain;

beforeEach(() => {
  vi.clearAllMocks();
  ipcMain = createMockIpcMain();
  registerToolHandlers(ipcMain);
});

// ═════════════════════════════════════════════════════════════════════════════
// tools:*
// ═════════════════════════════════════════════════════════════════════════════

describe('tools:* IPC handlers', () => {
  it('tools:list calls service.getToolsList and returns result', async () => {
    const expected = [{ name: 'add', description: 'Adds numbers' }];
    mockService.getToolsList.mockResolvedValue(expected);

    const result = await ipcMain._handlers['tools:list'](makeEvent());
    expect(mockService.getToolsList).toHaveBeenCalledOnce();
    expect(result).toBe(expected);
  });

  it('tools:create calls service.createTool with params', async () => {
    const params = { name: 'my_tool', description: 'does stuff', implementation: 'return 42;' };
    mockService.createTool.mockResolvedValue({ created: 'my_tool' });

    const result = await ipcMain._handlers['tools:create'](makeEvent(), params);
    expect(mockService.createTool).toHaveBeenCalledWith(params);
    expect(result).toEqual({ created: 'my_tool' });
  });

  it('tools:update calls service.updateTool with params', async () => {
    const params = { name: 'my_tool', description: 'updated' };
    mockService.updateTool.mockResolvedValue({ updated: 'my_tool' });

    const result = await ipcMain._handlers['tools:update'](makeEvent(), params);
    expect(mockService.updateTool).toHaveBeenCalledWith(params);
    expect(result).toEqual({ updated: 'my_tool' });
  });

  it('tools:delete calls service.deleteTool with params', async () => {
    mockService.deleteTool.mockResolvedValue({ deleted: 'my_tool' });

    const result = await ipcMain._handlers['tools:delete'](makeEvent(), { name: 'my_tool' });
    expect(mockService.deleteTool).toHaveBeenCalledWith({ name: 'my_tool' });
    expect(result).toEqual({ deleted: 'my_tool' });
  });

  it('tools:execute calls service.runTool with params', async () => {
    const params = { name: 'my_tool', arguments: { x: 1 } };
    mockService.runTool.mockResolvedValue({ result: 42 });

    const result = await ipcMain._handlers['tools:execute'](makeEvent(), params);
    expect(mockService.runTool).toHaveBeenCalledWith(params);
    expect(result).toEqual({ result: 42 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// toolModules:*
// ═════════════════════════════════════════════════════════════════════════════

describe('toolModules:* IPC handlers', () => {
  it('toolModules:list calls service.getModulesList', async () => {
    mockService.getModulesList.mockResolvedValue([{ name: 'http-client' }]);

    const result = await ipcMain._handlers['toolModules:list'](makeEvent());
    expect(mockService.getModulesList).toHaveBeenCalledOnce();
    expect(result).toEqual([{ name: 'http-client' }]);
  });

  it('toolModules:get calls service.getToolModule with params', async () => {
    mockService.getToolModule.mockResolvedValue({ name: 'http-client' });

    const result = await ipcMain._handlers['toolModules:get'](makeEvent(), { name: 'http-client' });
    expect(mockService.getToolModule).toHaveBeenCalledWith({ name: 'http-client' });
    expect(result).toEqual({ name: 'http-client' });
  });

  it('toolModules:create calls service.createToolModule with params', async () => {
    const params = { name: 'string-utils', description: 'Utils', content: 'export const x = 1;' };
    mockService.createToolModule.mockResolvedValue({ created: 'string-utils' });

    const result = await ipcMain._handlers['toolModules:create'](makeEvent(), params);
    expect(mockService.createToolModule).toHaveBeenCalledWith(params);
    expect(result).toEqual({ created: 'string-utils' });
  });

  it('toolModules:update calls service.updateToolModule with params', async () => {
    const params = { name: 'http-client', description: 'new desc' };
    mockService.updateToolModule.mockResolvedValue({ updated: 'http-client' });

    const result = await ipcMain._handlers['toolModules:update'](makeEvent(), params);
    expect(mockService.updateToolModule).toHaveBeenCalledWith(params);
    expect(result).toEqual({ updated: 'http-client' });
  });

  it('toolModules:delete calls service.deleteToolModule with params', async () => {
    mockService.deleteToolModule.mockResolvedValue({ deleted: 'http-client' });

    const result = await ipcMain._handlers['toolModules:delete'](makeEvent(), { name: 'http-client' });
    expect(mockService.deleteToolModule).toHaveBeenCalledWith({ name: 'http-client' });
    expect(result).toEqual({ deleted: 'http-client' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// toolDeps:*
// ═════════════════════════════════════════════════════════════════════════════

describe('toolDeps:* IPC handlers', () => {
  it('toolDeps:list calls service.getDepsList', async () => {
    mockService.getDepsList.mockResolvedValue({ dependencies: { axios: '1.0.0' }, devDependencies: {} });

    const result = await ipcMain._handlers['toolDeps:list'](makeEvent());
    expect(mockService.getDepsList).toHaveBeenCalledOnce();
    expect(result).toEqual({ dependencies: { axios: '1.0.0' }, devDependencies: {} });
  });

  it('toolDeps:install calls service.installToolDeps with params', async () => {
    mockService.installToolDeps.mockResolvedValue({ success: true, packages: ['axios'] });

    const result = await ipcMain._handlers['toolDeps:install'](makeEvent(), { packages: ['axios'] });
    expect(mockService.installToolDeps).toHaveBeenCalledWith({ packages: ['axios'] });
    expect(result).toEqual({ success: true, packages: ['axios'] });
  });

  it('toolDeps:remove calls service.removeToolDep with params', async () => {
    mockService.removeToolDep.mockResolvedValue({ success: true });

    const result = await ipcMain._handlers['toolDeps:remove'](makeEvent(), { name: 'axios' });
    expect(mockService.removeToolDep).toHaveBeenCalledWith({ name: 'axios' });
    expect(result).toEqual({ success: true });
  });
});
