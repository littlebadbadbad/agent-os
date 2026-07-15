/**
 * extensions/user-input/__tests__/requestUserInput/askUser.test.ts
 *
 * Full coverage for askUserTool and toRequest.
 * Covers all 5 prompt types, bound/unbound modes, cancellation, edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  askUserTool,
  toRequest,
  CANCEL_MSG,
  UNBOUND_OK_MSG,
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
    const r = toRequest({ type: 'text', question: 'Name?', placeholder: 'e.g. Alice', default_value: 'Bob', bind_to_tool: true });
    expect(r).toEqual({
      type: 'text',
      message: 'Name?',
      placeholder: 'e.g. Alice',
      defaultValue: 'Bob',
    });
  });

  it('builds a confirm request', () => {
    const r = toRequest({ type: 'confirm', question: 'Continue?', bind_to_tool: true });
    expect(r).toEqual({ type: 'confirm', message: 'Continue?' });
  });

  it('builds a select request with options', () => {
    const r = toRequest({ type: 'select', question: 'Pick:', options: ['A', 'B'], bind_to_tool: true });
    expect(r).toEqual({ type: 'select', message: 'Pick:', options: ['A', 'B'] });
  });

  it('defaults select options to empty array when missing', () => {
    const r = toRequest({ type: 'select', question: 'Pick:', bind_to_tool: true });
    expect(r.options).toEqual([]);
  });

  it('builds a multiSelect request with min/max', () => {
    const r = toRequest({
      type: 'multiSelect',
      question: 'Choose:',
      options: ['X', 'Y', 'Z'],
      min_select: 1,
      max_select: 2,
      bind_to_tool: true,
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
      bind_to_tool: true,
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

// ── Tool execute — bound mode (bind_to_tool=true, default) ───────────────────

describe('askUserTool.execute — bound mode', () => {
  it('returns the user answer as the tool result', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('my answer');
    const sendMessage = vi.fn();
    const ctx = makeContext({ requestUserInput, sendMessage });

    const result = await askUserTool.execute(
      { type: 'text', question: 'Enter value:', bind_to_tool: true } as AskUserParams,
      ctx,
    );
    expect(result).toBe('my answer');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('returns cancellation message when user cancels', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue(null);
    const sendMessage = vi.fn();
    const ctx = makeContext({ requestUserInput, sendMessage });

    const result = await askUserTool.execute(
      { type: 'confirm', question: 'Proceed?', bind_to_tool: true } as AskUserParams,
      ctx,
    );
    expect(result).toBe(CANCEL_MSG);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('works with confirm type', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('yes');
    const ctx = makeContext({ requestUserInput });
    const result = await askUserTool.execute(
      { type: 'confirm', question: 'Continue?', bind_to_tool: true } as AskUserParams,
      ctx,
    );
    expect(result).toBe('yes');
  });

  it('works with number type', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('42');
    const ctx = makeContext({ requestUserInput });
    const result = await askUserTool.execute(
      { type: 'number', question: 'Age:', bind_to_tool: true } as AskUserParams,
      ctx,
    );
    expect(result).toBe('42');
  });

  it('requests with the correct UserInputRequest shape', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('answer');
    const ctx = makeContext({ requestUserInput });
    await askUserTool.execute(
      { type: 'select', question: 'Pick:', options: ['A', 'B'], bind_to_tool: true } as AskUserParams,
      ctx,
    );
    const req = requestUserInput.mock.calls[0][0];
    expect(req.type).toBe('select');
    expect(req.message).toBe('Pick:');
    expect(req.options).toEqual(['A', 'B']);
  });

  it('bind_to_tool defaults to true when omitted', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('ans');
    const sendMessage = vi.fn();
    const ctx = makeContext({ requestUserInput, sendMessage });
    // Call without bind_to_tool (zod default applies)
    const params = askUserSchema.parse({ type: 'text', question: 'Q?' });
    expect(params.bind_to_tool).toBe(true);
    const result = await askUserTool.execute(params, ctx);
    expect(result).toBe('ans');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ── Tool execute — unbound mode (bind_to_tool=false) ────────────────────────

describe('askUserTool.execute — unbound mode', () => {
  it('calls sendMessage and returns UNBOUND_OK_MSG', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('user interjection');
    const sendMessage = vi.fn();
    const ctx = makeContext({ requestUserInput, sendMessage });

    const result = await askUserTool.execute(
      { type: 'text', question: 'Say something:', bind_to_tool: false } as AskUserParams,
      ctx,
    );
    expect(sendMessage).toHaveBeenCalledWith('user interjection');
    expect(result).toBe(UNBOUND_OK_MSG);
  });

  it('does not call sendMessage when user cancels', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue(null);
    const sendMessage = vi.fn();
    const ctx = makeContext({ requestUserInput, sendMessage });

    const result = await askUserTool.execute(
      { type: 'confirm', question: 'Proceed?', bind_to_tool: false } as AskUserParams,
      ctx,
    );
    expect(result).toBe(CANCEL_MSG);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('works with multiSelect type', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('["A","B"]');
    const sendMessage = vi.fn();
    const ctx = makeContext({ requestUserInput, sendMessage });

    const result = await askUserTool.execute(
      { type: 'multiSelect', question: 'Pick:', options: ['A', 'B', 'C'], bind_to_tool: false } as AskUserParams,
      ctx,
    );
    expect(sendMessage).toHaveBeenCalledWith('["A","B"]');
    expect(result).toBe(UNBOUND_OK_MSG);
  });

  it('handles missing sendMessage gracefully (tool should still return UNBOUND_OK_MSG)', async () => {
    const requestUserInput = vi.fn<[any, string?], Promise<string | null>>().mockResolvedValue('text');
    const ctx = makeContext({ requestUserInput, sendMessage: undefined });

    const result = await askUserTool.execute(
      { type: 'text', question: 'Q?', bind_to_tool: false } as AskUserParams,
      ctx,
    );
    expect(result).toBe(UNBOUND_OK_MSG);
  });
});
