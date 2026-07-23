/**
 * Tests for backend/core/models.js — super built-in "models" plugin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/models.js', () => ({
  listModels: vi.fn(),
}));

import { listModels } from '../services/models.js';

describe('core/models plugin', () => {
  let router;
  let register;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const mod = await import('../core/models.js');
    register = mod.register;
  });

  it('registers list method', () => {
    register(router);
    expect(router.registerApi).toHaveBeenCalledWith('models', 'list', expect.any(Function));
  });

  it('list handler forwards provider param', async () => {
    register(router);
    const handler = router.registerApi.mock.calls[0][2];
    vi.mocked(listModels).mockResolvedValue([{ id: 'm1', name: 'Model 1' }]);

    const result = await handler({ provider: 'doubao' });

    expect(result).toEqual([{ id: 'm1', name: 'Model 1' }]);
    expect(listModels).toHaveBeenCalledWith('doubao');
  });

  it('list handler works without provider', async () => {
    register(router);
    const handler = router.registerApi.mock.calls[0][2];
    vi.mocked(listModels).mockResolvedValue([]);

    const result = await handler(undefined);

    expect(result).toEqual([]);
    expect(listModels).toHaveBeenCalledWith(undefined);
  });
});
