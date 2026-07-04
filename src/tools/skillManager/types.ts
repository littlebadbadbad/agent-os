// ── Skill entry (what the backend stores) ─────────────────────────────────────

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
 *
 * The default HTTP implementation talks to the Agent SDK backend's
 * `/api/skills` routes.  Swap it for a test double or alternative store
 * without touching the manager logic.
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

// ── HTTP adapter config ───────────────────────────────────────────────────────

export type HttpSkillAdapterConfig = {
  /** Base URL of the Agent SDK backend. Defaults to `/api`. */
  baseUrl?: string;
};
