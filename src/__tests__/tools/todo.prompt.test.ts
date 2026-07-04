import { describe, it, expect } from 'vitest';
import { buildTaskTrackingSectionContent } from '../../tools/todo/prompt';

describe('buildTaskTrackingSectionContent', () => {
  it('returns a non-empty string', () => {
    const prompt = buildTaskTrackingSectionContent([]);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('includes section header', () => {
    const prompt = buildTaskTrackingSectionContent([]);
    expect(prompt).toMatch(/## Task Tracking/i);
  });

  it('returns guidance when list is empty', () => {
    const prompt = buildTaskTrackingSectionContent([]);
    expect(prompt).toMatch(/Task Tracking/);
    // no task list appended
    expect(prompt).not.toMatch(/\[Current tasks/);
  });

  it('returns guidance when items is undefined', () => {
    const prompt = buildTaskTrackingSectionContent(undefined);
    expect(prompt).toMatch(/Task Tracking/);
  });

  it('formats in-progress tasks', () => {
    const prompt = buildTaskTrackingSectionContent([
      { id: 1, title: 'Write tests', status: 'in-progress' },
    ]);
    expect(prompt).toContain('Write tests');
    expect(prompt).toContain('in-progress');
  });

  it('formats blocked tasks', () => {
    const prompt = buildTaskTrackingSectionContent([
      { id: 1, title: 'Blocked task', status: 'blocked' },
    ]);
    expect(prompt).toContain('Blocked task');
    expect(prompt).toContain('blocked');
  });

  it('formats not-started tasks', () => {
    const prompt = buildTaskTrackingSectionContent([
      { id: 1, title: 'Pending task', status: 'not-started' },
    ]);
    expect(prompt).toContain('Pending task');
    expect(prompt).toContain('pending');
  });

  it('includes all tasks', () => {
    const prompt = buildTaskTrackingSectionContent([
      { id: 1, title: 'Active', status: 'in-progress' },
      { id: 2, title: 'Waiting', status: 'blocked' },
      { id: 3, title: 'Todo', status: 'not-started' },
    ]);
    expect(prompt).toContain('Active');
    expect(prompt).toContain('Waiting');
    expect(prompt).toContain('Todo');
  });
});
