import { describe, it, expect } from 'vitest';
import {
  isAgentError,
  toolNotFoundError,
  toolValidationError,
  toolPermissionError,
  toolExecutionError,
} from '../../tools/errors';

describe('isAgentError', () => {
  it('returns true for an error created by toolNotFoundError', () => {
    expect(isAgentError(toolNotFoundError('my_tool'))).toBe(true);
  });

  it('returns true for an error created by toolValidationError', () => {
    expect(isAgentError(toolValidationError('my_tool', 'invalid'))).toBe(true);
  });

  it('returns true for an error created by toolPermissionError', () => {
    expect(isAgentError(toolPermissionError('my_tool', 'denied'))).toBe(true);
  });

  it('returns true for an error created by toolExecutionError', () => {
    expect(isAgentError(toolExecutionError('my_tool', new Error('oops')))).toBe(true);
  });

  it('returns true for toolExecutionError with a string cause', () => {
    expect(isAgentError(toolExecutionError('my_tool', 'oops'))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isAgentError(new Error('plain'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAgentError(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isAgentError('not an error')).toBe(false);
  });

  it('returns false for an object without _agentError', () => {
    expect(isAgentError({ message: 'fake' })).toBe(false);
  });
});

describe('toolNotFoundError', () => {
  it('creates an error with TOOL_NOT_FOUND code', () => {
    const err = toolNotFoundError('missing_tool');
    expect(err.code).toBe('TOOL_NOT_FOUND');
    expect(err.message).toContain('missing_tool');
    expect(err.message).toContain('not registered');
    expect(err.toolName).toBe('missing_tool');
  });
});

describe('toolValidationError', () => {
  it('creates an error with TOOL_VALIDATION code', () => {
    const err = toolValidationError('my_tool', 'expected number, got string');
    expect(err.code).toBe('TOOL_VALIDATION');
    expect(err.message).toBe('expected number, got string');
    expect(err.toolName).toBe('my_tool');
  });
});

describe('toolPermissionError', () => {
  it('creates an error with TOOL_PERMISSION code', () => {
    const err = toolPermissionError('danger_tool', 'not allowed');
    expect(err.code).toBe('TOOL_PERMISSION');
    expect(err.message).toBe('not allowed');
    expect(err.toolName).toBe('danger_tool');
  });
});

describe('toolExecutionError', () => {
  it('creates an error with TOOL_EXECUTION code from Error cause', () => {
    const cause = new Error('something broke');
    const err = toolExecutionError('crash_tool', cause);
    expect(err.code).toBe('TOOL_EXECUTION');
    expect(err.message).toBe('something broke');
    expect(err.toolName).toBe('crash_tool');
  });

  it('creates an error with TOOL_EXECUTION code from string cause', () => {
    const err = toolExecutionError('crash_tool', 'manual fail');
    expect(err.message).toBe('manual fail');
  });

  it('creates an error with TOOL_EXECUTION code from object cause', () => {
    const err = toolExecutionError('crash_tool', { custom: 'error' });
    expect(err.message).toBe('{"custom":"error"}');
  });

  it('_agentError is non-enumerable', () => {
    const err = toolNotFoundError('test');
    expect(JSON.parse(JSON.stringify(err))._agentError).toBeUndefined();
    expect(isAgentError(err)).toBe(true);
  });

  it('code is enumerable', () => {
    const err = toolNotFoundError('test');
    expect(JSON.parse(JSON.stringify(err)).code).toBe('TOOL_NOT_FOUND');
  });
});
