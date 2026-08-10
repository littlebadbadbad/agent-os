/**
 * Tests for backend/lib/plugin-services.js — createPluginServiceRegistry
 *
 * Covers:
 *   register — success, duplicate, invalid name, null/undefined impl
 *   resolve — existing, missing, type-parameter behaviour
 *   list — empty, populated, after unregister
 *   unregister — removes service, resolver returns undefined
 *   Edge cases — empty string name, registered count
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createPluginServiceRegistry } from '../lib/plugin-services.js';

let registry;

beforeEach(() => {
  registry = createPluginServiceRegistry();
});

// ── register ─────────────────────────────────────────────────────────────────

describe('register', () => {
  it('registers a service and returns an unregister function', () => {
    const unreg = registry.register('logger', { log: () => {} });
    expect(typeof unreg).toBe('function');
    expect(registry.resolve('logger')).toBeDefined();
  });

  it('registers multiple services independently', () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    registry.register('svc-a', a);
    registry.register('svc-b', b);

    expect(registry.resolve('svc-a')).toBe(a);
    expect(registry.resolve('svc-b')).toBe(b);
  });

  it('throws when serviceName is not a string', () => {
    expect(() => registry.register(123, {})).toThrow('serviceName must be a non-empty string');
    expect(() => registry.register(null, {})).toThrow('serviceName must be a non-empty string');
  });

  it('throws when serviceName is an empty string', () => {
    expect(() => registry.register('', {})).toThrow('serviceName must be a non-empty string');
  });

  it('throws when implementation is null', () => {
    expect(() => registry.register('foo', null)).toThrow('must not be null/undefined');
  });

  it('throws when implementation is undefined', () => {
    expect(() => registry.register('foo', undefined)).toThrow('must not be null/undefined');
  });

  it('throws when registering the same name twice', () => {
    registry.register('svc', {});
    expect(() => registry.register('svc', {})).toThrow('already registered');
  });

  it('accepts any non-null implementation value (string, number, array, class)', () => {
    registry.register('str', 'hello');
    registry.register('num', 42);
    registry.register('arr', [1, 2, 3]);
    registry.register('fn', class Foo {});
    registry.register('bool', true);

    expect(registry.resolve('str')).toBe('hello');
    expect(registry.resolve('num')).toBe(42);
    expect(registry.resolve('arr')).toEqual([1, 2, 3]);
    expect(typeof registry.resolve('fn')).toBe('function');
    expect(registry.resolve('bool')).toBe(true);
  });
});

// ── resolve ──────────────────────────────────────────────────────────────────

describe('resolve', () => {
  it('returns undefined for an unknown service', () => {
    expect(registry.resolve('nope')).toBeUndefined();
  });

  it('returns the exact implementation object that was registered', () => {
    const impl = { doStuff() { return 1; } };
    registry.register('svc', impl);
    expect(registry.resolve('svc')).toBe(impl);
  });

  it('returns undefined after the service is unregistered', () => {
    const unreg = registry.register('svc', {});
    unreg();
    expect(registry.resolve('svc')).toBeUndefined();
  });

  it('returns undefined for a name that was never registered', () => {
    registry.register('existing', {});
    expect(registry.resolve('other')).toBeUndefined();
  });

  it('can resolve multiple times and returns same reference', () => {
    const impl = {};
    registry.register('svc', impl);
    expect(registry.resolve('svc')).toBe(impl);
    expect(registry.resolve('svc')).toBe(impl);
    expect(registry.resolve('svc')).toBe(impl);
  });
});

// ── list ─────────────────────────────────────────────────────────────────────

describe('list', () => {
  it('returns an empty array for an empty registry', () => {
    expect(registry.list()).toEqual([]);
  });

  it('returns all registered service names in insertion order', () => {
    registry.register('alpha', {});
    registry.register('beta', {});
    registry.register('gamma', {});
    expect(registry.list()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('does not include unregistered services', () => {
    registry.register('a', {});
    const unreg = registry.register('b', {});
    registry.register('c', {});
    unreg();
    expect(registry.list()).toEqual(['a', 'c']);
  });

  it('returns empty array after all services are unregistered', () => {
    const u1 = registry.register('a', {});
    const u2 = registry.register('b', {});
    u1();
    u2();
    expect(registry.list()).toEqual([]);
  });

  it('returns a new array each call (not the internal Map keys)', () => {
    registry.register('x', {});
    const list1 = registry.list();
    const list2 = registry.list();
    expect(list1).not.toBe(list2);
    expect(list1).toEqual(list2);
  });
});

// ── unregister ────────────────────────────────────────────────────────────────

describe('unregister', () => {
  it('removes the service from the registry', () => {
    registry.register('svc', {});
    registry.resolve('svc'); // should exist
    const unreg = registry.register('svc2', {});
    unreg();
    expect(registry.resolve('svc2')).toBeUndefined();
    expect(registry.resolve('svc')).toBeDefined(); // other svc intact
  });

  it('unregister function is idempotent (calling twice does not throw)', () => {
    const unreg = registry.register('svc', {});
    unreg();
    expect(() => unreg()).not.toThrow();
  });

  it('can re-register after unregister', () => {
    const unreg = registry.register('svc', { x: 1 });
    unreg();
    const impl = { x: 2 };
    registry.register('svc', impl);
    expect(registry.resolve('svc')).toBe(impl);
  });
});

// ── Isolation ─────────────────────────────────────────────────────────────────

describe('isolation', () => {
  it('each createPluginServiceRegistry() returns an independent registry', () => {
    const r1 = createPluginServiceRegistry();
    const r2 = createPluginServiceRegistry();

    r1.register('only-in-r1', {});
    expect(r1.resolve('only-in-r1')).toBeDefined();
    expect(r2.resolve('only-in-r1')).toBeUndefined();
  });
});
