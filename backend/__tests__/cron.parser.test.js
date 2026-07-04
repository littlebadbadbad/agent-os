/**
 * Tests for backend/lib/cron-manager/human.js
 *
 * Verifies that cronToHuman delegates to cronstrue correctly and
 * provides a safe no-throw fallback for invalid expressions.
 */

import { describe, it, expect } from 'vitest';
import { cronToHuman } from '../lib/cron-manager/human.js';

describe('cronToHuman', () => {
  it('returns a non-empty string for valid expressions', () => {
    const expressions = [
      '* * * * *',
      '*/5 * * * *',
      '0 * * * *',
      '0 9 * * *',
      '0 9 * * 1',
      '0 9 * * 1-5',
      '0 0 1 * *',
      '30 */2 * * *',
    ];
    for (const expr of expressions) {
      const result = cronToHuman(expr);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // cronstrue always returns natural language, never the raw expression
      expect(result).not.toBe(expr);
    }
  });

  it('falls back to the raw expression for invalid input', () => {
    expect(cronToHuman('not-valid')).toBe('not-valid');
    expect(cronToHuman('60 * * * *')).toBe('60 * * * *');
  });

  it('produces correct human descriptions (smoke tests)', () => {
    expect(cronToHuman('* * * * *')).toMatch(/every minute/i);
    expect(cronToHuman('*/5 * * * *')).toMatch(/5 minute/i);
    expect(cronToHuman('0 9 * * 1')).toMatch(/09:00/);
  });
});
