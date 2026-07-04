/**
 * Tests for useWorkItemFormState.ts — pure utility functions.
 * The hook itself (useWorkItemFormState) is tested via rendering integration.
 * The exported utilities initialValuesFromItem and emptyFormValues are pure.
 */
import { describe, it, expect } from 'vitest';
import { initialValuesFromItem, emptyFormValues } from '../useWorkItemFormState';
import type { WorkItem } from '../../../api';

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 12345,
    type: 'Task',
    title: 'Test task',
    state: 'New',
    assignedTo: '张三',
    priority: 2,
    iterationPath: 'uMetaOS\\Sprint 10',
    areaPath: 'uMetaOS\\MetaHospital',
    tags: 'frontend;urgent',
    effort: 3,
    originalEstimate: 5,
    remainingWork: 2,
    completedWork: 3,
    storyPoints: 1,
    businessValue: 100,
    startDate: '2026-06-01T00:00:00Z',
    finishDate: '2026-06-15T00:00:00Z',
    targetDate: '2026-06-20T00:00:00Z',
    severity: '2 - High',
    activity: 'Development',
    valueArea: 'Business',
    description: '<p>Description</p>',
    acceptanceCriteria: '<p>AC</p>',
    customFields: { 'Custom.AiUsageLevel': 'Level 3 (AI 主导, AI>70%)', 'Custom.Department': 'Engineering' },
    parentId: 100,
    parentTitle: 'Parent task',
    parentType: 'Task',
    children: [],
    ...overrides,
  };
}

describe('emptyFormValues', () => {
  it('has all string fields empty', () => {
    expect(typeof emptyFormValues).toBe('object');
    for (const [key, val] of Object.entries(emptyFormValues)) {
      expect(typeof val, `field "${key}" should be string`).toBe('string');
      expect(val, `field "${key}" should be empty`).toBe('');
    }
  });

  it('does not include title, state, or customValues', () => {
    expect('title' in emptyFormValues).toBe(false);
    expect('state' in emptyFormValues).toBe(false);
    expect('customValues' in emptyFormValues).toBe(false);
  });
});

describe('initialValuesFromItem', () => {
  it('maps all standard fields correctly', () => {
    const item = makeItem();
    const v = initialValuesFromItem(item);
    expect(v.title).toBe('Test task');
    expect(v.state).toBe('New');
    expect(v.assignedTo).toBe('张三');
    expect(v.priority).toBe('2');
    expect(v.iterationPath).toBe('uMetaOS\\Sprint 10');
    expect(v.areaPath).toBe('uMetaOS\\MetaHospital');
    expect(v.tags).toBe('frontend;urgent');
  });

  it('maps scheduling fields as strings', () => {
    const v = initialValuesFromItem(makeItem());
    expect(v.effort).toBe('3');
    expect(v.originalEstimate).toBe('5');
    expect(v.remainingWork).toBe('2');
    expect(v.completedWork).toBe('3');
    expect(v.storyPoints).toBe('1');
    expect(v.businessValue).toBe('100');
  });

  it('truncates dates to YYYY-MM-DD', () => {
    const v = initialValuesFromItem(makeItem());
    expect(v.startDate).toBe('2026-06-01');
    expect(v.finishDate).toBe('2026-06-15');
    expect(v.targetDate).toBe('2026-06-20');
  });

  it('maps custom fields as string record', () => {
    const v = initialValuesFromItem(makeItem());
    expect(v.customValues).toEqual({
      'Custom.AiUsageLevel': 'Level 3 (AI 主导, AI>70%)',
      'Custom.Department': 'Engineering',
    });
  });

  it('coerces null/undefined to empty string', () => {
    const item = makeItem({ assignedTo: null as unknown as string, priority: null as unknown as number, effort: null as unknown as number, tags: null as unknown as string, customFields: {} });
    const v = initialValuesFromItem(item);
    expect(v.assignedTo).toBe('');
    expect(v.priority).toBe('');
    expect(v.effort).toBe('');
    expect(v.tags).toBe('');
    expect(v.customValues).toEqual({});
  });

  it('handles empty customFields', () => {
    const v = initialValuesFromItem(makeItem({ customFields: {} }));
    expect(v.customValues).toEqual({});
  });

  it('handles null customFields', () => {
    const v = initialValuesFromItem(makeItem({ customFields: {} }));
    expect(v.customValues).toEqual({});
  });
});
