import { describe, it, expect } from 'vitest';
import { pick } from '../utils/index';

describe('pick', () => {
  it('picks specified keys from an object', () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });

  it('picks a single key', () => {
    const obj = { x: 'hello', y: 'world' };
    expect(pick(obj, ['x'])).toEqual({ x: 'hello' });
  });

  it('returns empty object for empty keys array', () => {
    const obj = { a: 1, b: 2 };
    expect(pick(obj, [])).toEqual({});
  });

  it('returns all keys when all keys specified', () => {
    const obj = { a: 1, b: 2 };
    expect(pick(obj, ['a', 'b'])).toEqual({ a: 1, b: 2 });
  });

  it('preserves value types', () => {
    const obj = { n: 42, s: 'hi', b: true, o: { nested: true } };
    const result = pick(obj, ['n', 's', 'o']);
    expect(result).toEqual({ n: 42, s: 'hi', o: { nested: true } });
  });
});
