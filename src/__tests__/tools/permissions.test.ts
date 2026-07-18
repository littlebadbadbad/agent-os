/**
 * Unit tests for the permission-checking pipeline.
 */

import { describe, it, expect } from 'vitest';
import { matchPermissionRule, resolveRuleAction } from '../../tools/permissions/pipeline';

// ── matchPermissionRule ───────────────────────────────────────────────────────

describe('matchPermissionRule', () => {
  it('matches exact tool name', () => {
    expect(matchPermissionRule('terminal_send', 'terminal_send')).toBe(true);
  });

  it('does not match different exact name', () => {
    expect(matchPermissionRule('terminal_send', 'terminal_read')).toBe(false);
  });

  it('matches wildcard suffix', () => {
    expect(matchPermissionRule('terminal_*', 'terminal_send')).toBe(true);
    expect(matchPermissionRule('terminal_*', 'terminal_read')).toBe(true);
  });

  it('matches catch-all pattern', () => {
    expect(matchPermissionRule('*', 'any_tool')).toBe(true);
    expect(matchPermissionRule('*', '')).toBe(true);
  });

  it('does not match when wildcard prefix differs', () => {
    expect(matchPermissionRule('file_*', 'terminal_send')).toBe(false);
  });

  it('treats wildcard in non-suffix position as exact match', () => {
    expect(matchPermissionRule('*_tool', 'my_tool')).toBe(false);
    expect(matchPermissionRule('*_tool', '*_tool')).toBe(true);
  });
});

// ── resolveRuleAction ─────────────────────────────────────────────────────────

describe('resolveRuleAction', () => {
  it('returns undefined for empty rules', () => {
    const result = resolveRuleAction({}, 'any_tool');
    expect(result).toBeUndefined();
  });

  it('returns the action for a matching exact rule', () => {
    const result = resolveRuleAction({ terminal_send: 'deny' }, 'terminal_send');
    expect(result).toBe('deny');
  });

  it('returns the action for a matching wildcard rule', () => {
    const result = resolveRuleAction({ 'terminal_*': 'ask' }, 'terminal_send');
    expect(result).toBe('ask');
  });

  it('returns undefined when no rule matches', () => {
    const result = resolveRuleAction({ terminal_send: 'deny' }, 'file_read');
    expect(result).toBeUndefined();
  });

  it('returns first matching rule action (insertion order)', () => {
    const result = resolveRuleAction(
      { 'terminal_*': 'ask', terminal_send: 'deny' },
      'terminal_send',
    );
    // 'terminal_*' matches first by insertion order
    expect(result).toBe('ask');
  });

  // ── Null guards ──────────────────────────────────────────────────────────

  it('returns undefined when rules is null', () => {
    const result = resolveRuleAction(null as unknown as Record<string, 'allow' | 'deny' | 'ask'>, 'any_tool');
    expect(result).toBeUndefined();
  });

  it('returns undefined when rules is undefined', () => {
    const result = resolveRuleAction(undefined as unknown as Record<string, 'allow' | 'deny' | 'ask'>, 'any_tool');
    expect(result).toBeUndefined();
  });
});
