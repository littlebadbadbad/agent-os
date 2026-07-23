/**
 * Tests for agent-UI/config.ts
 */

import { describe, it, expect } from 'vitest';

describe('config', () => {
  it('exports BACKEND_URL as empty string', async () => {
    const { BACKEND_URL } = await import('../config');
    expect(BACKEND_URL).toBe('');
  });
});
