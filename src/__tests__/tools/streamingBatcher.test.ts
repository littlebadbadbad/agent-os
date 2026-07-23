/**
 * Tests for the shared streaming text batcher.
 *
 * Verifies that `makeBatchedAppender` accumulates deltas and flushes them
 * via the callback at most once per animation frame.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeBatchedAppender } from '../../tools/streamingBatcher';

describe('makeBatchedAppender', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flush invokes callback with accumulated text', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('Hello');
    appender.append(' ');
    appender.append('World');
    appender.flush();

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('Hello World');
  });

  it('flush without any append does not invoke callback', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.flush();

    expect(onFlush).not.toHaveBeenCalled();
  });

  it('multiple appends flush in a single callback', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('A');
    appender.append('B');
    appender.flush();

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('AB');
  });

  it('flush after each append delivers correct chunks', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('First');
    appender.flush();
    appender.append('Second');
    appender.flush();

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenNthCalledWith(1, 'First');
    expect(onFlush).toHaveBeenNthCalledWith(2, 'Second');
  });

  it('rAF schedules a flush and delivers accumulated text', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('Delta-1');
    appender.append('Delta-2');

    // No flush yet — waiting for rAF
    expect(onFlush).not.toHaveBeenCalled();

    // Advance past the rAF threshold
    vi.advanceTimersByTime(16);

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('Delta-1Delta-2');
  });

  it('multiple append calls before rAF are batched into one flush', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('A');
    appender.append('B');
    appender.append('C');

    vi.advanceTimersByTime(16);

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('ABC');
  });

  it('append after rAF flush schedules a new frame', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('First batch');
    vi.advanceTimersByTime(16);
    expect(onFlush).toHaveBeenCalledWith('First batch');

    appender.append('Second batch');
    vi.advanceTimersByTime(16);

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenNthCalledWith(2, 'Second batch');
  });

  it('empty string append does not trigger rAF', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('');

    // No content accumulated, so no rAF should be scheduled
    vi.advanceTimersByTime(100);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('flush then append then rAF delivers correctly', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('Pre-flush');
    appender.flush();
    expect(onFlush).toHaveBeenNthCalledWith(1, 'Pre-flush');

    appender.append('Post-flush');
    vi.advanceTimersByTime(16);
    expect(onFlush).toHaveBeenNthCalledWith(2, 'Post-flush');
  });

  it('flush can be called many times from inside the same frame', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('X');
    appender.flush();
    appender.flush(); // second flush with empty buffer
    appender.flush(); // third flush with empty buffer

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('X');
  });

  it('scheduled flag prevents duplicate rAF scheduling', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('A');
    appender.append('B');
    // Only one rAF should be scheduled for all appends
    vi.advanceTimersByTime(16);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith('AB');
  });

  it('scheduled flag resets after flush', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('First');
    vi.advanceTimersByTime(16);
    expect(onFlush).toHaveBeenCalledWith('First');

    appender.append('Second');
    vi.advanceTimersByTime(16);
    expect(onFlush).toHaveBeenNthCalledWith(2, 'Second');
  });

  it('append of empty string does NOT call schedule', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);
    // buffer was '' before append, '' += '' = ''
    // schedule() is still called but buffer stays '' — flush early-returns
    appender.append('');
    appender.append('');
    // inside schedule: buffer is ''+''+'' = '' still, concatenation happens
    // Actually buffer = '' + '' = '' on first append; then on second append buffer = '' + '' = ''
    // schedule sets scheduled=true, rAF fires flush, but flush checks !buffer → return
    vi.advanceTimersByTime(16);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('append then multiple flushes then rAF works', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('First');
    appender.flush(); // explicit flush of 'First'
    appender.flush(); // no-op (buffer empty)
    appender.append('Second');
    vi.advanceTimersByTime(16); // rAF flush of 'Second'

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenNthCalledWith(1, 'First');
    expect(onFlush).toHaveBeenNthCalledWith(2, 'Second');
  });
});

describe('makeBatchedAppender — setTimeout fallback (no rAF)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Delete rAF AFTER useFakeTimers so the fake is removed
    // @ts-expect-error deleting rAF to test setTimeout fallback path
    delete globalThis.requestAnimationFrame;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses setTimeout when requestAnimationFrame is not available', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('Hello');
    appender.append(' World');

    // setTimeout(flush, 0) should be scheduled
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('Hello World');
  });

  it('multiple appends before setTimeout are batched', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('A');
    appender.append('B');
    appender.append('C');

    vi.advanceTimersByTime(0);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('ABC');
  });

  it('append after setTimeout schedules a new timeout', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('First');
    vi.advanceTimersByTime(0);
    expect(onFlush).toHaveBeenCalledWith('First');

    appender.append('Second');
    vi.advanceTimersByTime(0);
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenNthCalledWith(2, 'Second');
  });

  it('explicit flush works alongside setTimeout fallback', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('Buffered');
    appender.flush();
    expect(onFlush).toHaveBeenCalledWith('Buffered');

    // setTimeout was scheduled but buffer is empty — no-op on fire
    vi.advanceTimersByTime(0);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('flush before setTimeout callback fires', () => {
    const onFlush = vi.fn();
    const appender = makeBatchedAppender(onFlush);

    appender.append('Pre-timeout');
    appender.flush(); // synchronous flush before timeout fires
    expect(onFlush).toHaveBeenCalledWith('Pre-timeout');

    // scheduled=true, buffer='', setTimeout fires but flush early-returns
    vi.advanceTimersByTime(0);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});
