import type { PluginStateExtension, PluginUiAdapter } from '@agent-type';
import type { ToolButtonSlotDeclaration, AutocompleteSlotDeclaration, ToolCardSlotDeclaration, CompactToolCardSlotDeclaration } from '@agent-type';
import type { SkillState } from './skill';
export type { SkillState };

// ── Backend skill entry ───────────────────────────────────────────────────────

export type BackendSkill = {
  name:        string;
  description: string;
  version?:    string;
  author?:     string;
  /** Raw system-prompt body from the SKILL.md file. */
  systemPrompt: string;
  /** Script filenames under `scripts/` (executable by the AI). */
  scripts:     string[];
  /** Absolute path to the skill directory on the backend. */
  skillPath?:  string;
  updatedAt:   string;
};

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * Plug-in contract for the skill backend.
 */
export type SkillManagerAdapter = {
  /** Return all installed skills. */
  listSkills(): Promise<BackendSkill[]>;

  /**
   * Install a skill.
   * Either `url` (GitHub folder / raw skill.md) or both `name` + `content`
   * (raw markdown text) must be provided.
   */
  installSkill(input: {
    url?:     string;
    name?:    string;
    content?: string;
  }): Promise<{ installed: string; message: string }>;

  /** Uninstall a skill by name. */
  removeSkill(name: string): Promise<{ deleted: string }>;

  /**
   * Read a file from inside a skill's directory (e.g. `references/REFERENCE.md`).
   */
  readSkillFile(skill: string, path: string): Promise<{ content: string; path: string }>;
};

// ── Module augmentation ───────────────────────────────────────────────────────

declare module '@agent-type' {
  interface PluginStateExtension {
    type: 'skillManager';
    skills: readonly SkillState[];
    sync: () => Promise<void>;
    slots: readonly (ToolButtonSlotDeclaration | AutocompleteSlotDeclaration | ToolCardSlotDeclaration | CompactToolCardSlotDeclaration)[];
  }
}
