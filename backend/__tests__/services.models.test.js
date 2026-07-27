/**
 * Tests for backend/services/models.js — Models listing service
 *
 * Source imports from ./model-config.js. From this test file,
 * the relative path is ../services/model-config.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetMergedProvider = vi.fn();
const mockListMergedModelsForProvider = vi.fn();
const mockListMergedProviderNames = vi.fn();

vi.mock('../services/model-config.js', () => ({
  getMergedProvider: mockGetMergedProvider,
  listMergedModelsForProvider: mockListMergedModelsForProvider,
  listMergedProviderNames: mockListMergedProviderNames,
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

let models;
beforeEach(async () => {
  vi.clearAllMocks();
  models = await import('../services/models.js');
});

describe('listModels', () => {
  it('returns provider name and models for a known provider', async () => {
    mockGetMergedProvider.mockReturnValue({ name: 'openai', models: [{ id: 'gpt-4' }] });
    mockListMergedModelsForProvider.mockReturnValue([{ id: 'gpt-4', name: 'GPT-4' }]);
    const result = await models.listModels('openai');
    expect(result).toEqual({ provider: 'openai', models: [{ id: 'gpt-4', name: 'GPT-4' }] });
    expect(mockGetMergedProvider).toHaveBeenCalledWith('openai');
    expect(mockListMergedModelsForProvider).toHaveBeenCalledWith('openai');
  });

  it('throws for unknown provider', async () => {
    mockGetMergedProvider.mockReturnValue(undefined);
    mockListMergedProviderNames.mockReturnValue(['a', 'b']);
    await expect(models.listModels('unknown')).rejects.toThrow('Unknown provider "unknown"');
  });

  it('returns all providers grouped by name when called without arg', async () => {
    mockListMergedProviderNames.mockReturnValue(['a', 'b']);
    mockListMergedModelsForProvider.mockReturnValueOnce([{ id: 'm1' }]);
    mockListMergedModelsForProvider.mockReturnValueOnce([{ id: 'm2' }]);
    const result = await models.listModels();
    expect(result).toEqual({ providers: { a: [{ id: 'm1' }], b: [{ id: 'm2' }] } });
    expect(mockListMergedProviderNames).toHaveBeenCalledOnce();
    expect(mockListMergedModelsForProvider).toHaveBeenCalledTimes(2);
  });

  it('returns all providers when called with empty string', async () => {
    mockListMergedProviderNames.mockReturnValue(['x']);
    mockListMergedModelsForProvider.mockReturnValue([]);
    const result = await models.listModels('');
    expect(result).toEqual({ providers: { x: [] } });
  });

  it('handles provider with no models', async () => {
    mockGetMergedProvider.mockReturnValue({ name: 'empty', models: [] });
    mockListMergedModelsForProvider.mockReturnValue([]);
    const result = await models.listModels('empty');
    expect(result).toEqual({ provider: 'empty', models: [] });
  });

  it('returns empty providers object when none exist', async () => {
    mockListMergedProviderNames.mockReturnValue([]);
    const result = await models.listModels();
    expect(result).toEqual({ providers: {} });
  });
});
