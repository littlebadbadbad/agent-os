// ── Types ──────────────────────────────────────────────────────────────────────
export type { Skill, SkillState } from './skill';
export type { SkillManagerAdapter, BackendSkill } from './types';

// ── Plugin adapter ─────────────────────────────────────────────────────────────
export { createSkillPluginAdapter } from './pluginAdapter';

// ── ToolSet ────────────────────────────────────────────────────────────────────
export { createSkillToolset } from './manager';
export { SKILL_MANAGER_SYMBOL } from './manager';

// ── Activation ─────────────────────────────────────────────────────────────────
export { activate } from './activate';
