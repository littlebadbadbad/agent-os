/**
 * Tests for shared utility functions.
 */

import { describe, it, expect } from 'vitest';
import { createId } from '../../utils/shared';

describe('createId', () => {
  it('returns a non-empty string', () => {
    const id = createId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('returns different values on each call', () => {
    const id1 = createId();
    const id2 = createId();
    expect(id1).not.toBe(id2);
  });
});
