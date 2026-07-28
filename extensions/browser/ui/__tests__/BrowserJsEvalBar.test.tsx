/**
 * @vitest-environment happy-dom
 *
 * Tests for BrowserJsEvalBar component.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, screen, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BrowserJsEvalBar, type BrowserJsEvalBarProps } from '../BrowserJsEvalBar';
import { createMockAdapter } from './mockAdapter';

afterEach(() => {
  cleanup();
});

function renderBar(props?: Partial<BrowserJsEvalBarProps>) {
  const adapter = createMockAdapter();
  const defaults: BrowserJsEvalBarProps = {
    adapter,
    browserId: 'test-browser',
    alive: true,
  };
  return render(<BrowserJsEvalBar {...defaults} {...props} />);
}

/** Flush pending microtasks (e.g. after a resolved promise). */
async function flushMicrotasks() {
  await act(() => Promise.resolve());
}

describe('BrowserJsEvalBar', () => {
  it('renders the JS input field', () => {
    renderBar();
    const input = screen.getByPlaceholderText(/document\.title/);
    expect(input).toBeTruthy();
  });

  it('disables input when session is not alive', () => {
    renderBar({ alive: false });
    const input = screen.getByPlaceholderText(/document\.title/);
    expect(input).toBeDisabled();
  });

  it('disables run button when input is empty', () => {
    renderBar();
    const runBtn = screen.getByTitle('Run JS (Enter)');
    expect(runBtn).toBeDisabled();
  });

  it('enables run button when input has text', () => {
    renderBar();
    const input = screen.getByPlaceholderText(/document\.title/);
    fireEvent.change(input, { target: { value: '1+1' } });

    const runBtn = screen.getByTitle('Run JS (Enter)');
    expect(runBtn).not.toBeDisabled();
  });

  it('calls adapter.evaluate on Enter and shows result', async () => {
    const adapter = createMockAdapter();
    adapter._fns.evaluate.mockResolvedValue(42);
    renderBar({ adapter });

    const input = screen.getByPlaceholderText(/document\.title/);
    fireEvent.change(input, { target: { value: '1+1' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await flushMicrotasks();

    expect(screen.getByText(/\u2713 42/)).toBeTruthy();
  });

  it('shows error result when evaluation fails', async () => {
    const adapter = createMockAdapter();
    adapter._fns.evaluate.mockRejectedValue(new Error('SyntaxError'));
    renderBar({ adapter });

    const input = screen.getByPlaceholderText(/document\.title/);
    fireEvent.change(input, { target: { value: 'bad code' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await flushMicrotasks();

    expect(screen.getByText(/\u2717.*SyntaxError/)).toBeTruthy();
  });

  it('calls adapter.evaluate on Run button click', async () => {
    const adapter = createMockAdapter();
    adapter._fns.evaluate.mockResolvedValue('click result');
    renderBar({ adapter });

    const input = screen.getByPlaceholderText(/document\.title/);
    fireEvent.change(input, { target: { value: 'document.title' } });

    const runBtn = screen.getByTitle('Run JS (Enter)');
    fireEvent.click(runBtn);

    await flushMicrotasks();

    expect(screen.getByText(/\u2713 click result/)).toBeTruthy();
  });

  it('disables button while running', async () => {
    const adapter = createMockAdapter();
    let resolvePromise: (v: unknown) => void;
    const pendingPromise = new Promise((resolve) => { resolvePromise = resolve; });
    adapter._fns.evaluate.mockReturnValue(pendingPromise);

    renderBar({ adapter });

    const input = screen.getByPlaceholderText(/document\.title/);
    fireEvent.change(input, { target: { value: 'test' } });

    const runBtn = screen.getByTitle('Run JS (Enter)');
    fireEvent.click(runBtn);

    // Button should be disabled while running.
    expect(runBtn).toBeDisabled();

    // Resolve the pending promise.
    resolvePromise!('done');
    await flushMicrotasks();
  });
});
