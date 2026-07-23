/**
 * Tests for backend/lib/logger.js — Structured logger.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chalk before any imports so createLogger can capture our mocks
vi.mock('chalk', () => {
  const identity = (s) => s;
  identity.black = identity;
  identity.white = identity;
  const chain = new Proxy(identity, { get: () => chain });
  return {
    default: chain,
    bgCyan: { black: identity },
    bgGreen: { black: identity },
    bgYellow: { black: identity },
    bgRed: { white: identity },
    bgGray: { white: identity },
    dim: identity,
    bold: identity,
  };
});

describe('createLogger', () => {
  let log;
  let mockLog, mockWarn, mockError;

  beforeEach(async () => {
    mockLog = vi.fn();
    mockWarn = vi.fn();
    mockError = vi.fn();
    delete process.env.LOG_LEVEL;
    vi.resetModules();
    vi.stubGlobal('console', { log: mockLog, warn: mockWarn, error: mockError });
    const mod = await import('../lib/logger.js');
    log = mod.createLogger('test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an object with info, ok, warn, error, debug methods', () => {
    expect(log).toHaveProperty('info');
    expect(log).toHaveProperty('ok');
    expect(log).toHaveProperty('warn');
    expect(log).toHaveProperty('error');
    expect(log).toHaveProperty('debug');
    expect(typeof log.info).toBe('function');
  });

  it('info calls console.log', () => {
    log.info('hello');
    expect(mockLog).toHaveBeenCalled();
  });

  it('warn calls console.warn', () => {
    log.warn('warning');
    expect(mockWarn).toHaveBeenCalled();
  });

  it('error calls console.error', () => {
    log.error('error');
    expect(mockError).toHaveBeenCalled();
  });

  it('ok calls console.log', () => {
    log.ok('ok');
    expect(mockLog).toHaveBeenCalled();
  });

  it('debug calls console.log', () => {
    log.debug('debug');
    expect(mockLog).toHaveBeenCalled();
  });
});

describe('createLogger — silent mode', () => {
  let log;
  let mockLog, mockWarn, mockError;

  beforeEach(async () => {
    mockLog = vi.fn();
    mockWarn = vi.fn();
    mockError = vi.fn();
    process.env.LOG_LEVEL = 'silent';
    vi.resetModules();
    vi.stubGlobal('console', { log: mockLog, warn: mockWarn, error: mockError });
    const mod = await import('../lib/logger.js');
    log = mod.createLogger('silent-test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('silent mode suppresses all output', () => {
    log.info('x'); log.warn('x'); log.error('x'); log.debug('x'); log.ok('x');
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });
});
