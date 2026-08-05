import type { JsonValue } from './types';

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export function jsonTypeOf(value: JsonValue): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as 'string' | 'number' | 'boolean' | 'object';
}
