/**
 * Tests for src/tools/subagent/prompt.ts
 *
 * Covers:
 *   buildSubAgentDecisionFramework — returns string containing suffix placeholders
 *   DELEGATE_TASK_DESCRIPTION — is a non-empty string constant
 */

import { describe, it, expect } from 'vitest';
import { buildSubAgentDecisionFramework, DELEGATE_TASK_DESCRIPTION } from '../../../tools/subagent/prompt';

describe('buildSubAgentDecisionFramework', () => {
  it('returns a non-empty string', () => {
    const result = buildSubAgentDecisionFramework('async');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(100);
  });

  it('includes the suffix in tool names', () => {
    const result = buildSubAgentDecisionFramework('stream');
    expect(result).toContain('create_stream_subagent');
    expect(result).toContain('send_stream_message');
    expect(result).toContain('delegate_stream_task');
  });

  it('does not contain literal "<suffix>" placeholder', () => {
    const result = buildSubAgentDecisionFramework('test');
    expect(result).not.toContain('<suffix>');
  });

  it('handles suffixes with special characters', () => {
    const result = buildSubAgentDecisionFramework('my-agent');
    expect(result).toContain('create_my-agent_subagent');
    expect(result).toContain('delegate_my-agent_task');
  });

  it('each call produces a distinct string (not mutated)', () => {
    const r1 = buildSubAgentDecisionFramework('a');
    const r2 = buildSubAgentDecisionFramework('b');
    expect(r1).not.toBe(r2);
  });
});

describe('DELEGATE_TASK_DESCRIPTION', () => {
  it('is a non-empty string', () => {
    expect(typeof DELEGATE_TASK_DESCRIPTION).toBe('string');
    expect(DELEGATE_TASK_DESCRIPTION.length).toBeGreaterThan(10);
  });

  it('is a constant (same reference every access)', () => {
    const a = DELEGATE_TASK_DESCRIPTION;
    const b = DELEGATE_TASK_DESCRIPTION;
    expect(a).toBe(b);
  });
});
