/**
 * Skill ToolSet -- Meta-tools + skill lifecycle
 *
 * Skills live in `.agent/skills/<name>/` on the backend (agentskills.io standard):
 *   SKILL.md        -- YAML frontmatter (name, description, metadata) + system-prompt body
 *   scripts/        -- optional; executable scripts the AI can be told to run
 *   references/     -- optional; detailed docs loaded on demand
 *   assets/         -- optional; templates, images, data files
 *
 * A single ToolSet named 'skill-manager' is created by `createSkillToolset`.
 * Register it on agents via `agent.registerToolSet(skillToolset)` — the ToolSet
 * captures agent references via `onAttach` and handles all tool registration:
 *   - Its static `tools` are the 4 management meta-tools (install / list / remove / read).
 *   - Skill tools are injected into attached agents dynamically via `agent.registerTool`
 *     when a skill is loaded, and removed via the returned cleanup fn when unloaded.
 *   - `onGetSystemPrompt` and `onGetState` aggregate over the live skill map so the
 *     agent always sees the current set of loaded skills without any secondary registration.
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { defineSkill } from '../skill';
import { resolveSkillTools } from '../skill';
import type { Skill, SkillState } from '../skill';
import type { Tool } from '@agent-type';
import type { ToolSet, ToolSetContext, AgentClientLike, SystemPromptContext } from '@agent-type';
import type { BackendSkill, SkillManagerAdapter } from './types';

// -- Module augmentation ------------------------------------------------------
// Contributes `skills` to AgentSessionState without touching the core type.

declare module '@agent-type' {
  interface AgentSessionExtension {
    skills?: readonly SkillState[];
  }
}

// -- Types --------------------------------------------------------------------

/** Minimal agent interface required by the skill manager. */
type AgentEntry = AgentClientLike;

type LoadedSkillEntry = {
  skill: Skill;
  resolvedTools: readonly Tool[];
  /** Cleanup fns returned by `agent.registerTool` -- one array per agent. */
  toolCleanupsByAgent: Map<AgentEntry, Array<() => void>>;
};

// -- Private helpers ----------------------------------------------------------

/**
 * Extract `/word` slash-mention tokens from a user message.
 * Determines which skills are explicitly activated in a given turn.
 */
function parseSlashMentions(text: string): readonly string[] {
  return [...text.matchAll(/\/([\w-]+)/g)].map((m) => m[1]);
}

// -- SDK Skill converter ------------------------------------------------------

function toSdkSkill(entry: BackendSkill): Skill {
  let systemPrompt = entry.systemPrompt || undefined;

  if (entry.skillPath) {
    const pathNote = entry.scripts?.length
      ? `\n\n> **Skill directory**: \`${entry.skillPath}\`\n` +
        `> To run scripts open a terminal with \`cwd\` set to this path, then:\n` +
        entry.scripts.map((s) => `>   \`${entry.skillPath}/scripts/${s}\``).join('\n')
      : `\n\n> **Skill directory**: \`${entry.skillPath}\``;
    systemPrompt = systemPrompt ? systemPrompt + pathNote : pathNote;
  }

  return defineSkill({
    name:        entry.name,
    description: entry.description,
    version:     entry.version,
    author:      entry.author,
    tools:       [],
    systemPrompt,
  });
}

// -- Manager factory ----------------------------------------------------------

/**
 * Build the skill management ToolSet.
 *
 * Register it on agents via `agent.registerToolSet(skillToolset)`.  The ToolSet
 * captures agent references via `onAttach` and handles all tool registration:
 *
 * - Static `tools`: the 4 management meta-tools (install / list / remove / read).
 * - Skill tools loaded dynamically via `agent.registerTool` on all attached agents.
 * - System-prompt injection and state contributions for all loaded skills.
 *
 * @param adapter  Skill backend adapter (`createHttpSkillAdapter` for the default backend).
 *
 * @example
 * ```ts
 * const skillToolset = createSkillToolset(createHttpSkillAdapter({ baseUrl: '/api' }));
 * for (const agent of agents) agent.registerToolSet(skillToolset);
 * ```
 */
export function createSkillToolset(adapter: SkillManagerAdapter) {
  /** Agents attached via onAttach — skills are loaded into all of them. */
  const attachedAgents: AgentEntry[] = [];

  /** Live skill state, keyed by skill name. */
  const loadedSkills = new Map<string, LoadedSkillEntry>();

  /** Per-session UI subscribers -- notified whenever the skill list changes. */
  const subscribers = new Map<string, Set<() => void>>();

  function notify(): void {
    for (const fns of subscribers.values()) {
      for (const fn of fns) fn();
    }
  }

  function loadIntoAgents(skill: Skill): void {
    // Unload any previous version first (re-install scenario).
    unloadFromAgents(skill.name);
    const resolvedTools = resolveSkillTools(skill);
    const toolCleanupsByAgent = new Map<AgentEntry, Array<() => void>>();
    for (const agent of attachedAgents) {
      toolCleanupsByAgent.set(agent, resolvedTools.map((t) => agent.registerTool(t)));
    }
    loadedSkills.set(skill.name, { skill, resolvedTools, toolCleanupsByAgent });
    notify();
  }

  function unloadFromAgents(name: string): void {
    const entry = loadedSkills.get(name);
    if (!entry) return;
    for (const cleanups of entry.toolCleanupsByAgent.values()) {
      for (const fn of cleanups) fn();
    }
    loadedSkills.delete(name);
    notify();
  }

  // -- Startup hydration ------------------------------------------------------

  adapter
    .listSkills()
    .then((skills) => {
      if (skills.length) {
        for (const entry of skills) loadIntoAgents(toSdkSkill(entry));
        console.log(`[skillManager] hydrated ${skills.length} skill(s)`);
      }
    })
    .catch((err) => {
      console.warn('[skillManager] startup hydration failed:', err?.message ?? err);
    });

  // -- syncSkills -------------------------------------------------------------

  async function syncSkills(): Promise<void> {
    const skills = await adapter.listSkills();
    const backendNames = new Set(skills.map((s) => s.name));
    for (const entry of skills) loadIntoAgents(toSdkSkill(entry));
    for (const name of [...loadedSkills.keys()]) {
      if (!backendNames.has(name)) unloadFromAgents(name);
    }
  }

  // -- install_skill ----------------------------------------------------------

  const installSkillTool = defineTool({
    name: 'install_skill',
    group: 'Skills',
    description:
      'Install a skill from a URL (GitHub folder or raw skill.md file) or from raw markdown text. ' +
      'After installation the skill is immediately available in the session.',
    parameters: z.object({
      url: z
        .string()
        .optional()
        .describe('URL to a skill.md file (raw) or a GitHub tree folder containing skill.md'),
      name: z
        .string()
        .optional()
        .describe('Skill name -- required when installing from content text'),
      content: z
        .string()
        .optional()
        .describe('Raw skill.md markdown -- required when installing from content text'),
    }),
    execute: async ({ url, name, content }) => {
      const result = await adapter.installSkill({ url, name, content });
      await syncSkills();
      return result;
    },
  });

  // -- list_skills ------------------------------------------------------------

  const listSkillsTool = defineTool({
    name: 'list_skills',
    group: 'Skills',
    description: 'List all currently installed skills and their scripts.',
    parameters: z.object({}),
    execute: async () => {
      const skills = await adapter.listSkills();
      return skills.map((s) => ({
        name:        s.name,
        description: s.description,
        ...(s.version && { version: s.version }),
        ...(s.author  && { author:  s.author }),
        scriptCount: s.scripts?.length ?? 0,
        scripts:     s.scripts ?? [],
        updatedAt:   s.updatedAt,
      }));
    },
  });

  // -- remove_skill -----------------------------------------------------------

  const removeSkillTool = defineTool({
    name: 'remove_skill',
    group: 'Skills',
    description: 'Uninstall a skill by name. Removes it from disk and unloads it from all agents.',
    parameters: z.object({
      name: z.string().describe('The skill name to remove'),
    }),
    execute: async ({ name }) => {
      const result = await adapter.removeSkill(name);
      unloadFromAgents(name);
      return result;
    },
  });

  // -- read_skill_file --------------------------------------------------------

  const readSkillFileTool = defineTool({
    name: 'read_skill_file',
    group: 'Skills',
    description:
      "Read a file from inside a skill's directory. Use this to load references, docs, " +
      'examples or assets on demand -- e.g. "references/REFERENCE.md", "docs/examples.md". ' +
      'The SKILL.md body will tell you which files are available and when to read them.',
    parameters: z.object({
      skill: z.string().describe('Skill name, e.g. "azure-devops"'),
      path:  z.string().describe('Relative path within the skill directory, e.g. "docs/reference.md"'),
    }),
    execute: async ({ skill, path }) => {
      return adapter.readSkillFile(skill, path);
    },
  });

  // -- Single ToolSet ---------------------------------------------------------
  // The 4 management tools are the ToolSet's static tools.
  // Skill tools are managed via agent.registerTool; the ToolSet contributes
  // system-prompt injection and state aggregation for all loaded skills.

  const managerToolSet: ToolSet & { syncSkills: () => Promise<void> } = {
    name: 'skill-manager',
    coreTools: ['list_skills'],
    tools: [installSkillTool, listSkillsTool, removeSkillTool, readSkillFileTool],

    onAttach(agent: AgentClientLike): () => void {
      attachedAgents.push(agent);
      // Load all currently-installed skills into the newly attached agent.
      for (const { skill, resolvedTools, toolCleanupsByAgent } of loadedSkills.values()) {
        toolCleanupsByAgent.set(agent, resolvedTools.map((t) => agent.registerTool(t)));
        void skill; // suppress unused-variable warning
      }
      return () => {
        const idx = attachedAgents.indexOf(agent);
        if (idx !== -1) attachedAgents.splice(idx, 1);
        // Unload skill tools for this agent only.
        for (const entry of loadedSkills.values()) {
          const cleanups = entry.toolCleanupsByAgent.get(agent);
          if (cleanups) { for (const fn of cleanups) fn(); entry.toolCleanupsByAgent.delete(agent); }
        }
      };
    },

    onGetSystemPrompt(_ctx: ToolSetContext, { userMessage }: SystemPromptContext): string | undefined {
      const parts: string[] = [];
      for (const { skill } of loadedSkills.values()) {
        if (!skill.systemPrompt) continue;
        // Headless / programmatic call: always inject all skills.
        if (userMessage === undefined) { parts.push(skill.systemPrompt); continue; }
        // Only inject when the skill is explicitly mentioned via /skillname.
        const mentions = parseSlashMentions(userMessage);
        if (mentions.includes(skill.name)) {
          parts.push(skill.systemPrompt);
        }
      }
      return parts.length ? parts.join('\n\n') : undefined;
    },

    onGetState(_ctx: ToolSetContext): { skills: SkillState[] } {
      return {
        skills: [...loadedSkills.values()].map(({ skill, resolvedTools }) => ({
          name:        skill.name,
          description: skill.description,
          version:     skill.version,
          toolCount:   resolvedTools.length,
          toolNames:   resolvedTools.map((t) => t.name),
        })),
      };
    },

    onRemoveSession(ctx: ToolSetContext): void {
      subscribers.delete(ctx.sessionId);
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      let s = subscribers.get(ctx.sessionId);
      if (!s) { s = new Set(); subscribers.set(ctx.sessionId, s); }
      s.add(fn);
      return () => s!.delete(fn);
    },

    syncSkills,
  };

  return managerToolSet;
}

export type SkillToolset = ReturnType<typeof createSkillToolset>;

