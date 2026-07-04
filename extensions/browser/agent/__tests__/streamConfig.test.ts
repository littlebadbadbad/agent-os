import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STREAM_CONFIG,
  mergeStreamConfig,
  isValidStreamConfig,
  type StreamConfig,
} from '../streamConfig';

describe('DEFAULT_STREAM_CONFIG', () => {
  it('has fps=24 and quality=80', () => {
    expect(DEFAULT_STREAM_CONFIG).toEqual({ fps: 24, quality: 80 });
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(DEFAULT_STREAM_CONFIG)).toBe(true);
  });
});

describe('mergeStreamConfig', () => {
  it('returns defaults when called with undefined', () => {
    expect(mergeStreamConfig()).toEqual(DEFAULT_STREAM_CONFIG);
  });

  it('returns defaults when called with empty object', () => {
    expect(mergeStreamConfig({})).toEqual(DEFAULT_STREAM_CONFIG);
  });

  it('merges fps only', () => {
    const result = mergeStreamConfig({ fps: 30 });
    expect(result.fps).toBe(30);
    expect(result.quality).toBe(DEFAULT_STREAM_CONFIG.quality);
  });

  it('merges quality only', () => {
    const result = mergeStreamConfig({ quality: 50 });
    expect(result.fps).toBe(DEFAULT_STREAM_CONFIG.fps);
    expect(result.quality).toBe(50);
  });

  it('merges both fields', () => {
    const result = mergeStreamConfig({ fps: 60, quality: 10 });
    expect(result).toEqual({ fps: 60, quality: 10 });
  });

  it('clamps fps to 1–60', () => {
    expect(mergeStreamConfig({ fps: 0 }).fps).toBe(1);
    expect(mergeStreamConfig({ fps: -5 }).fps).toBe(1);
    expect(mergeStreamConfig({ fps: 61 }).fps).toBe(60);
    expect(mergeStreamConfig({ fps: 100 }).fps).toBe(60);
  });

  it('clamps quality to 10–100', () => {
    expect(mergeStreamConfig({ quality: 5 }).quality).toBe(10);
    expect(mergeStreamConfig({ quality: 0 }).quality).toBe(10);
    expect(mergeStreamConfig({ quality: 105 }).quality).toBe(100);
    expect(mergeStreamConfig({ quality: 200 }).quality).toBe(100);
  });

  it('rounds fps to integer', () => {
    expect(mergeStreamConfig({ fps: 24.7 }).fps).toBe(25);
    expect(mergeStreamConfig({ fps: 24.3 }).fps).toBe(24);
  });

  it('rounds quality to integer', () => {
    expect(mergeStreamConfig({ quality: 84.6 }).quality).toBe(85);
    expect(mergeStreamConfig({ quality: 84.4 }).quality).toBe(84);
  });
});

describe('isValidStreamConfig', () => {
  it('returns true for a valid config', () => {
    expect(isValidStreamConfig({ fps: 30, quality: 80 })).toBe(true);
  });

  it('returns true for boundary values', () => {
    expect(isValidStreamConfig({ fps: 1, quality: 10 })).toBe(true);
    expect(isValidStreamConfig({ fps: 60, quality: 100 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidStreamConfig(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidStreamConfig(undefined)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isValidStreamConfig('hello')).toBe(false);
    expect(isValidStreamConfig(42)).toBe(false);
    expect(isValidStreamConfig([])).toBe(false);
  });

  it('returns false when fps is out of range', () => {
    expect(isValidStreamConfig({ fps: 0, quality: 80 })).toBe(false);
    expect(isValidStreamConfig({ fps: 61, quality: 80 })).toBe(false);
  });

  it('returns false when quality is out of range', () => {
    expect(isValidStreamConfig({ fps: 30, quality: 9 })).toBe(false);
    expect(isValidStreamConfig({ fps: 30, quality: 101 })).toBe(false);
  });

  it('returns false when fps is not a number', () => {
    expect(isValidStreamConfig({ fps: '30', quality: 80 })).toBe(false);
  });
});
