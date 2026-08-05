import type { SkillState } from './skill';
export type { SkillState };

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
    /** Whether to route the fetch through the globally configured proxy. */
    useProxy?: boolean;
  }): Promise<{ installed: string; message: string }>;

  /** Uninstall a skill by name. */
  removeSkill(name: string): Promise<{ deleted: string }>;

  /**
   * Read a file from inside a skill's directory (e.g. `references/REFERENCE.md`).
   */
  readSkillFile(skill: string, path: string): Promise<{ content: string; path: string }>;
};

// ── Bridge: shared agent↔UI object ───────────────────────────────────────────

/**
 * Skill bridge — agent and UI hold the same reference.
 * Agent writes methods during activation; UI calls them via `host.bridge`.
 */
export interface SkillBridge {
  /** Sync skill list from backend. */
  sync(): Promise<BackendSkill[]>;
  /** Install a skill from URL or raw text. */
  install(config: {
    url?: string;
    name?: string;
    content?: string;
    useProxy?: boolean;
  }): Promise<{ installed: string; message: string }>;
  /** Remove a skill by name. */
  remove(name: string): Promise<{ deleted: string }>;
};
