/**
 * extensions/user-input/__tests__/requestUserInput/askUser.test.ts
 *
 * Full coverage for askUserTool and toRequest.
 * Covers all 5 prompt types, cancellation, edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  askUserTool,
  toRequest,
  CANCEL_MSG,
  askUserSchema,
} from '../../agent/requestUserInput/askUser';
import type { ToolExecutionContext } from '@agent-type';

// ── Schema inference helpers ─────────────────────────────────────────────────

type AskUserParams = z.infer<typeof askUserSchema>;

// ── Minimal context factory ───────────────────────────────────────────────────

function makeContext(overrides: Partial<Pick<ToolExecutionContext, 'requestUserInput' | 'sendMessage' | 'signal'>> = {}): ToolExecutionContext {
  return {
    sessionId: 'sess-1',
    agentName: 'main',
    conversationId: 'main',
    sourceAgent: 'main',
    isSubAgent: false,
    signal: new AbortController().signal,
    requestUserInput: overrides.requestUserInput ?? vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('user reply'),
    sendMessage: overrides.sendMessage ?? vi.fn(),
    ...overrides,
  } as unknown as ToolExecutionContext;
}

// ── toRequest ────────────────────────────────────────────────────────────────

describe('toRequest', () => {
  it('builds a text request', () => {
    const r = toRequest({ type: 'text', question: 'Name?', placeholder: 'e.g. Alice', default_value: 'Bob' });
    expect(r).toEqual({
      type: 'text',
      message: 'Name?',
      placeholder: 'e.g. Alice',
      defaultValue: 'Bob',
    });
  });

  it('builds a confirm request', () => {
    const r = toRequest({ type: 'confirm', question: 'Continue?' });
    expect(r).toEqual({ type: 'confirm', message: 'Continue?' });
  });

  it('builds a select request with options', () => {
    const r = toRequest({ type: 'select', question: 'Pick:', options: ['A', 'B'] });
    expect(r).toEqual({ type: 'select', message: 'Pick:', options: ['A', 'B'] });
  });

  it('defaults select options to empty array when missing', () => {
    const r = toRequest({ type: 'select', question: 'Pick:' });
    expect(r.options).toEqual([]);
  });

  it('builds a multiSelect request with min/max', () => {
    const r = toRequest({
      type: 'multiSelect',
      question: 'Choose:',
      options: ['X', 'Y', 'Z'],
      min_select: 1,
      max_select: 2,
    });
    expect(r).toEqual({
      type: 'multiSelect',
      message: 'Choose:',
      options: ['X', 'Y', 'Z'],
      minSelect: 1,
      maxSelect: 2,
    });
  });

  it('builds a number request with constraints', () => {
    const r = toRequest({
      type: 'number',
      question: 'Age:',
      placeholder: '0-150',
      default_number: 25,
      min: 0,
      max: 150,
      step: 1,
    });
    expect(r).toEqual({
      type: 'number',
      message: 'Age:',
      placeholder: '0-150',
      defaultValue: 25,
      min: 0,
      max: 150,
      step: 1,
    });
  });
});

// ── Tool metadata ────────────────────────────────────────────────────────────

describe('askUserTool metadata', () => {
  it('has name ask_user', () => {
    expect(askUserTool.name).toBe('ask_user');
  });

  it('has interaction group', () => {
    expect(askUserTool.group).toBe('interaction');
  });

  it('has a non-empty description', () => {
    expect(askUserTool.description).toBeTruthy();
    expect(askUserTool.description!.length).toBeLessThan(100);
  });

  it('has a Zod schema as parameters', () => {
    expect(askUserTool.parameters).toBe(askUserSchema);
  });
});

// ── Tool execute — missing requestUserInput ───────────────────────────────────

describe('askUserTool.execute — missing requestUserInput', () => {
  it('returns error when context.requestUserInput is undefined', async () => {
    const ctx = makeContext({ requestUserInput: undefined });
    const result = await askUserTool.execute({ type: 'text', question: 'Q?' } as AskUserParams, ctx);
    expect(result).toContain('requestUserInput is not available');
  });
});

// ── Tool execute — validation errors ─────────────────────────────────────────

describe('askUserTool.execute — validation', () => {
  it('returns error for select with fewer than 2 options', async () => {
    const ctx = makeContext();
    const result = await askUserTool.execute(
      { type: 'select', question: 'Pick:', options: ['Only'] } as AskUserParams,
      ctx,
    );
    expect(result).toContain('"select" requires at least 2 options');
  });

  it('returns error for multiSelect with fewer than 2 options', async () => {
    const ctx = makeContext();
    const result = await askUserTool.execute(
      { type: 'multiSelect', question: 'Pick:', options: ['Only'] } as AskUserParams,
      ctx,
    );
    expect(result).toContain('"multiSelect" requires at least 2 options');
  });

  it('returns error for select with no options', async () => {
    const ctx = makeContext();
    const result = await askUserTool.execute(
      { type: 'select', question: 'Pick:' } as unknown as AskUserParams,
      ctx,
    );
    expect(result).toContain('requires at least 2 options');
  });
});

// ── Tool execute — basic mode ────────────────────────────────────────

describe('askUserTool.execute', () => {
  it('returns the user answer as the tool result', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('my answer');
    const ctx = makeContext({ requestUserInput });

    const result = await askUserTool.execute(
      { type: 'text', question: 'Enter value:' } as AskUserParams,
      ctx,
    );
    expect(result).toBe('my answer');
  });

  it('returns cancellation message when user cancels', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue(null);
    const ctx = makeContext({ requestUserInput });

    const result = await askUserTool.execute(
      { type: 'confirm', question: 'Proceed?' } as AskUserParams,
      ctx,
    );
    expect(result).toBe(CANCEL_MSG);
  });

  it('works with confirm type', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('yes');
    const ctx = makeContext({ requestUserInput });
    const result = await askUserTool.execute(
      { type: 'confirm', question: 'Continue?' } as AskUserParams,
      ctx,
    );
    expect(result).toBe('yes');
  });

  it('works with number type', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('42');
    const ctx = makeContext({ requestUserInput });
    const result = await askUserTool.execute(
      { type: 'number', question: 'Age:' } as AskUserParams,
      ctx,
    );
    expect(result).toBe('42');
  });

  it('requests with the correct UserInputRequest shape', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('answer');
    const ctx = makeContext({ requestUserInput });
    await askUserTool.execute(
      { type: 'select', question: 'Pick:', options: ['A', 'B'] } as AskUserParams,
      ctx,
    );
    const req = requestUserInput.mock.calls[0][0];
    expect(req.type).toBe('select');
    expect(req.message).toBe('Pick:');
    expect(req.options).toEqual(['A', 'B']);
  });

  it('passes context.toolCallId as the id parameter to requestUserInput', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('answer');
    const ctx = makeContext({
      requestUserInput,
      toolCallId: 'call_00_abc123',
    });
    await askUserTool.execute(
      { type: 'text', question: 'Name?' } as AskUserParams,
      ctx,
    );
    // The second argument to requestUserInput must be the LLM's original tool call ID
    expect(requestUserInput.mock.calls[0][1]).toBe('call_00_abc123');
  });

  it('still works when context.toolCallId is undefined (no pipeline)', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('ok');
    const ctx = makeContext({ requestUserInput, toolCallId: undefined });
    await askUserTool.execute(
      { type: 'confirm', question: 'OK?' } as AskUserParams,
      ctx,
    );
    // When toolCallId is undefined, the second argument should be undefined
    // and requestUserInput will generate its own entry ID.
    expect(requestUserInput).toHaveBeenCalledOnce();
    expect(requestUserInput.mock.calls[0][1]).toBeUndefined();
  });

  it('passes toolCallId for each prompt type', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('ok');
    const ctx = makeContext({ requestUserInput, toolCallId: 'call_00_types' });

    const types: Array<AskUserParams> = [
      { type: 'text', question: 'Q1' },
      { type: 'confirm', question: 'Q2' },
      { type: 'select', question: 'Q3', options: ['A', 'B'] },
      { type: 'multiSelect', question: 'Q4', options: ['A', 'B'] },
      { type: 'number', question: 'Q5' },
    ];

    for (const params of types) {
      await askUserTool.execute(params, ctx);
    }

    // Every call should have the toolCallId as the second argument
    expect(requestUserInput).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i++) {
      expect(requestUserInput.mock.calls[i][1]).toBe('call_00_types');
    }
  });
});
