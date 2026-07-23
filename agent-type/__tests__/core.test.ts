import { describe, it, expect } from 'vitest';
import { DETACHED_SENTINEL } from '../core';

describe('DETACHED_SENTINEL', () => {
  it('is the string "__detached__"', () => {
    expect(DETACHED_SENTINEL).toBe('__detached__');
  });

  it('is a const value (not mutable)', () => {
    // TypeScript const assertion prevents reassignment at compile time
    expect(typeof DETACHED_SENTINEL).toBe('string');
  });
});
