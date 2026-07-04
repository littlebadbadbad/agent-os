import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { defineSkill, resolveSkillTools } from '../../tools/skill';

// ── Helpers ───────────────────────────────────────────────────────────────────

const stubTool = (name: string) => ({
  name,
  description: `tool-${name}`,
  parameters: z.object({}),
  execute: async () => null,
});

// ── defineSkill ───────────────────────────────────────────────────────────────

describe('defineSkill', () => {
  it('returns a frozen object', () => {
    const skill = defineSkill({
      name: 'test-skill',
      description: 'A test skill',
      tools: [],
    });
    expect(Object.isFrozen(skill)).toBe(true);
  });

  it('preserves all fields', () => {
    const tools = [stubTool('t1')];
    const skill = defineSkill({
      name: 'complete',
      description: 'Full skill',
      version: '2.0.0',
      author: 'Test Author',
      tools,
      systemPrompt: 'Use this skill carefully.',
    });

    expect(skill.name).toBe('complete');
    expect(skill.description).toBe('Full skill');
    expect(skill.version).toBe('2.0.0');
    expect(skill.author).toBe('Test Author');
    expect(skill.tools).toBe(tools);
    expect(skill.systemPrompt).toBe('Use this skill carefully.');
  });

  it('accepts optional fields as undefined', () => {
    const skill = defineSkill({ name: 'minimal', description: 'min', tools: [] });
    expect(skill.version).toBeUndefined();
    expect(skill.author).toBeUndefined();
    expect(skill.systemPrompt).toBeUndefined();
    expect(skill.setup).toBeUndefined();
  });

  it('accepts a setup function', () => {
    const setup = vi.fn(async () => {});
    const skill = defineSkill({
      name: 'with-setup',
      description: 'setup',
      tools: [],
      setup,
    });
    expect(skill.setup).toBe(setup);
  });
});

// ── resolveSkillTools ─────────────────────────────────────────────────────────

describe('resolveSkillTools', () => {
  it('returns the array directly when tools is a static array', () => {
    const tools = [stubTool('a'), stubTool('b')];
    const skill = defineSkill({ name: 's', description: 'd', tools });
    expect(resolveSkillTools(skill)).toBe(tools);
  });

  it('calls the factory function when tools is a function', () => {
    const tools = [stubTool('lazy')];
    const factory = vi.fn(() => tools);
    const skill = defineSkill({ name: 's', description: 'd', tools: factory });
    expect(resolveSkillTools(skill)).toBe(tools);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('calls the factory on every invocation', () => {
    const factory = vi.fn(() => [stubTool('x')]);
    const skill = defineSkill({ name: 's', description: 'd', tools: factory });
    resolveSkillTools(skill);
    resolveSkillTools(skill);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('returns empty array for a skill with no tools', () => {
    const skill = defineSkill({ name: 's', description: 'd', tools: [] });
    expect(resolveSkillTools(skill)).toHaveLength(0);
  });
});
