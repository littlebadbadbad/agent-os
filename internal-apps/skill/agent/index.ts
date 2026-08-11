// ── Types ──────────────────────────────────────────────────────────────────────
export type { Skill, SkillState } from './skill';
export type { SkillManagerAdapter, BackendSkill } from './types';

// ── App adapter ─────────────────────────────────────────────────────────────
export { createSkillAppAdapter } from './appAdapter';

// ── ToolSet ────────────────────────────────────────────────────────────────────
export { createSkillToolset } from './manager';
export { SKILL_MANAGER_SYMBOL } from './manager';

// ── Activation ─────────────────────────────────────────────────────────────────
export { activate } from './activate';
