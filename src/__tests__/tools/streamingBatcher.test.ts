/**
 * Tests for the shared streaming text batcher.
 *
 * Verifies that `makeBatchedAppender` accumulates deltas and flushes them
 * via the callback at most once per animation frame.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeBatchedAppender } from '../../tools/streamingBatcher';

describe('makeBatchedAppender', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
});
