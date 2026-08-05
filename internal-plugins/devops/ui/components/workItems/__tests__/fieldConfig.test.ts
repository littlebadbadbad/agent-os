/**
 * Tests for fieldConfig.ts — pure functions only.
 * No React / jsdom required.
 */
import { describe, it, expect } from 'vitest';
import { resolveFieldKind, fieldNeedsRemoteOptions, coerceFieldValue } from '../fieldConfig';
import type { WorkItemFieldDef } from '../../../api';

function def(overrides: Partial<WorkItemFieldDef> = {}): WorkItemFieldDef {
  return {
    referenceName: 'Custom.TestField',
    name: 'Test Field',
    type: 'string',
    isCustom: true,
    readOnly: false,
    isIdentity: false,
    isPicklist: false,
    ...overrides,
  };
}

describe('resolveFieldKind', () => {
  it('returns readonly for readOnly fields', () => {
    expect(resolveFieldKind(def({ readOnly: true }))).toBe('readonly');
  });

  it('returns autocomplete for identity fields', () => {
    expect(resolveFieldKind(def({ isIdentity: true }))).toBe('autocomplete');
    // identity type also gives autocomplete
    expect(resolveFieldKind(def({ type: 'identity' }))).toBe('autocomplete');
  });

  it('returns select for treePath', () => {
    expect(resolveFieldKind(def({ type: 'treePath' }))).toBe('select');
  });

  it('returns combobox for picklist types', () => {
    expect(resolveFieldKind(def({ type: 'picklistString' }))).toBe('combobox');
    expect(resolveFieldKind(def({ type: 'picklistInteger' }))).toBe('combobox');
    expect(resolveFieldKind(def({ type: 'picklistDouble' }))).toBe('combobox');
  });

  it('returns number for integer/double', () => {
    expect(resolveFieldKind(def({ type: 'integer' }))).toBe('number');
    expect(resolveFieldKind(def({ type: 'double' }))).toBe('number');
  });

  it('returns date for dateTime', () => {
    expect(resolveFieldKind(def({ type: 'dateTime' }))).toBe('date');
  });

  it('returns boolean for boolean', () => {
    expect(resolveFieldKind(def({ type: 'boolean' }))).toBe('boolean');
  });

  it('returns richtext for html', () => {
    expect(resolveFieldKind(def({ type: 'html' }))).toBe('richtext');
  });

  it('returns textarea for plainText', () => {
    expect(resolveFieldKind(def({ type: 'plainText' }))).toBe('textarea');
  });

  it('returns readonly for history', () => {
    expect(resolveFieldKind(def({ type: 'history' }))).toBe('readonly');
  });

  it('returns combobox for string with isPicklist', () => {
    expect(resolveFieldKind(def({ type: 'string', isPicklist: true }))).toBe('combobox');
  });

  it('returns text for plain string', () => {
    expect(resolveFieldKind(def({ type: 'string' }))).toBe('text');
  });
});

describe('fieldNeedsRemoteOptions', () => {
  it('returns false for readOnly fields', () => {
    expect(fieldNeedsRemoteOptions(def({ readOnly: true, isPicklist: true }))).toBe(false);
  });

  it('returns true for isPicklist fields', () => {
    expect(fieldNeedsRemoteOptions(def({ isPicklist: true }))).toBe(true);
  });

  it('returns true for picklistString/Integer/Double', () => {
    expect(fieldNeedsRemoteOptions(def({ type: 'picklistString' }))).toBe(true);
    expect(fieldNeedsRemoteOptions(def({ type: 'picklistInteger' }))).toBe(true);
    expect(fieldNeedsRemoteOptions(def({ type: 'picklistDouble' }))).toBe(true);
  });

  it('returns false for plain string', () => {
    expect(fieldNeedsRemoteOptions(def({ type: 'string' }))).toBe(false);
  });
});

describe('coerceFieldValue', () => {
  it('returns null for empty string', () => {
    expect(coerceFieldValue(def({ type: 'string' }), '')).toBe(null);
    expect(coerceFieldValue(def({ type: 'integer' }), '')).toBe(null);
    expect(coerceFieldValue(def({ type: 'boolean' }), '')).toBe(null);
  });

  it('coerces integer types to number', () => {
    expect(coerceFieldValue(def({ type: 'integer' }), '42')).toBe(42);
    expect(coerceFieldValue(def({ type: 'picklistInteger' }), '7')).toBe(7);
  });

  it('returns raw string if integer coercion fails', () => {
    expect(coerceFieldValue(def({ type: 'integer' }), 'abc')).toBe('abc');
  });

  it('coerces double types to number', () => {
    expect(coerceFieldValue(def({ type: 'double' }), '3.5')).toBe(3.5);
    expect(coerceFieldValue(def({ type: 'picklistDouble' }), '2.0')).toBe(2);
  });

  it('coerces boolean types', () => {
    expect(coerceFieldValue(def({ type: 'boolean' }), 'true')).toBe(true);
    expect(coerceFieldValue(def({ type: 'boolean' }), 'false')).toBe(false);
    expect(coerceFieldValue(def({ type: 'boolean' }), '')).toBe(null);
  });

  it('returns string for string types', () => {
    expect(coerceFieldValue(def({ type: 'string' }), 'hello')).toBe('hello');
  });

  it('returns string for html types', () => {
    expect(coerceFieldValue(def({ type: 'html' }), '<p>test</p>')).toBe('<p>test</p>');
  });
});
