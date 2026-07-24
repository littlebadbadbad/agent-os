import { describe, it, expect, vi } from 'vitest';
import { typedInvoke } from '../ipc-channels';

describe('typedInvoke', () => {
  it('calls invokeFn with channel and params', async () => {
    const invokeFn = vi.fn().mockResolvedValue('ok');
    const result = await typedInvoke(invokeFn, 'health:check', { id: 1 });
    expect(invokeFn).toHaveBeenCalledTimes(1);
    expect(invokeFn).toHaveBeenCalledWith('health:check', { id: 1 });
    expect(result).toBe('ok');
  });

  it('works without params', async () => {
    const invokeFn = vi.fn().mockResolvedValue(42);
    const result = await typedInvoke(invokeFn, 'health:check');
    expect(invokeFn).toHaveBeenCalledWith('health:check', undefined);
    expect(result).toBe(42);
  });

  it('propagates errors from invokeFn', async () => {
    const error = new Error('IPC failed');
    const invokeFn = vi.fn().mockRejectedValue(error);
    await expect(typedInvoke(invokeFn, 'api:models:list')).rejects.toThrow('IPC failed');
  });
});
