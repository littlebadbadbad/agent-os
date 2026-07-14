/**
 * Skill ToolSet -- Meta-tools + skill lifecycle
 *
 * Skills live in `.agent/skills/<name>/` on the backend:
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
 *   - `onGetSystemPrompt` and `onGetSymbolState` aggregate over the live skill map so the
 *     agent always sees the current set of loaded skills without any secondary registration.
 */

import { z } from "zod";
import { defineTool } from "@agent-type/defineTool";
import type { Tool } from "@agent-type";
import type {
  ToolSet,
  ToolSetContext,
  AgentClientLike,
  SystemPromptContext,
} from "@agent-type";
import { MAIN_CONVERSATION_ID } from "@agent-type";
import type {
  ToolButtonSlotDeclaration,
  AutocompleteSlotDeclaration,
  ToolCardSlotDeclaration,
  CompactToolCardSlotDeclaration,
  CompactToolCardDescriptor,
  ToolCallInfo,
} from "@agent-type";
import { defineSkill } from "./skill";
import { resolveSkillTools } from "./skill";
import type { Skill, SkillState } from "./skill";
import type { BackendSkill, SkillManagerAdapter } from "./types";

// -- Types --------------------------------------------------------------------

/** Minimal agent interface required by the skill manager. */
type AgentEntry = AgentClientLike;

type LoadedSkillEntry = {
  skill: Skill;
  resolvedTools: readonly Tool[];
  /** Cleanup fns returned by `agent.registerTool` -- one array per agent. */
  toolCleanupsByAgent: Map<AgentEntry, Array<() => void>>;
};

// -- Symbol -------------------------------------------------------------------

export const SKILL_MANAGER_SYMBOL = Symbol("skill-manager");

// -- Private helpers ----------------------------------------------------------

/**
 * Extract `/word` slash-mention tokens from a user message.
 * Determines which skills are explicitly activated in a given turn.
 */
function parseSlashMentions(text: string): readonly string[] {
  return [...text.matchAll(/\/([\w-]+)/g)].map((m) => m[1]);
}

// ── Compact tool-card descriptor helpers ──────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

const COMPACT_LABEL: Record<string, string> = {
  install_skill:    "Install Skill",
  list_skills:      "List Skills",
  remove_skill:     "Remove Skill",
  read_skill_file:  "Read File",
};

function skillDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const { name, arguments: args, status, result, error } = info;

  const fromError =
    status === "error" && error
      ? error.split("\n")[0].slice(0, 60)
      : undefined;
  if (fromError) {
    return { icon: "🔧", label: COMPACT_LABEL[name] ?? name, summary: fromError, status: "error" };
  }

  const label = COMPACT_LABEL[name] ?? name;
  let summary = label;

  switch (name) {
    case "install_skill": {
      const url = str(args?.url);
      const skillName = str(args?.name);
      const target = url ?? skillName ?? "?";
      if (status === "running") { summary = `Installing ${target}…`; break; }
      const installed = typeof result === "object" && result !== null
        ? String(Reflect.get(result, "installed") ?? "")
        : undefined;
      summary = installed ? `Installed ${installed}` : `Installed ${target}`;
      break;
    }
    case "list_skills": {
      if (status === "running") { summary = "Listing skills…"; break; }
      const count = arrLen(result);
      summary = `${count} skill${count !== 1 ? "s" : ""} installed`;
      break;
    }
    case "remove_skill": {
      const skillName = str(args?.name);
      if (status === "running") { summary = `Removing ${skillName ?? "skill"}…`; break; }
      summary = `${skillName ?? "Skill"} removed`;
      break;
    }
    case "read_skill_file": {
      const skill = str(args?.skill);
      const path = str(args?.path);
      if (status === "running") { summary = `Reading ${skill}/${path}…`; break; }
      summary = `${skill}/${path}`;
      break;
    }
  }

  return { icon: "🔧", label, summary, status };
}

// -- SDK Skill converter ------------------------------------------------------

function toSdkSkill(entry: BackendSkill): Skill {
  let systemPrompt = entry.systemPrompt || undefined;

  if (entry.skillPath) {
    const pathNote = entry.scripts?.length
      ? `\n\n> **Skill directory**: \`${entry.skillPath}\`\n` +
        `> To run scripts open a terminal with \`cwd\` set to this path, then:\n` +
        entry.scripts
          .map((s) => `>   \`${entry.skillPath}/scripts/${s}\``)
          .join("\n")
      : `\n\n> **Skill directory**: \`${entry.skillPath}\``;
    systemPrompt = systemPrompt ? systemPrompt + pathNote : pathNote;
  }

  return defineSkill({
    name: entry.name,
    description: entry.description,
    version: entry.version,
    author: entry.author,
    tools: [],
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
 * @param adapter  Skill backend adapter.
 */
export function createSkillToolset(adapter: SkillManagerAdapter): ToolSet {
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
      toolCleanupsByAgent.set(
        agent,
        resolvedTools.map((t) => agent.registerTool(t)),
      );
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
      console.warn(
        "[skillManager] startup hydration failed:",
        err?.message ?? err,
      );
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
    name: "install_skill",
    group: "Skills",
    description:
      "Install a skill from a URL (GitHub folder or raw skill.md file) or from raw markdown text. " +
      "After installation the skill is immediately available in the session.",
    parameters: z.object({
      url: z
        .string()
        .optional()
        .describe(
          "URL to a skill.md file (raw) or a GitHub tree folder containing skill.md",
        ),
      name: z
        .string()
        .optional()
        .describe("Skill name -- required when installing from content text"),
      content: z
        .string()
        .optional()
        .describe(
          "Raw skill.md markdown -- required when installing from content text",
        ),
    }),
    execute: async ({ url, name, content }) => {
      const result = await adapter.installSkill({ url, name, content });
      await syncSkills();
      return result;
    },
  });

  // -- list_skills ------------------------------------------------------------

  const listSkillsTool = defineTool({
    name: "list_skills",
    group: "Skills",
    description: "List all currently installed skills and their scripts.",
    parameters: z.object({}),
    execute: async () => {
      const skills = await adapter.listSkills();
      return skills.map((s) => ({
        name: s.name,
        description: s.description,
        ...(s.version && { version: s.version }),
        ...(s.author && { author: s.author }),
        scriptCount: s.scripts?.length ?? 0,
        scripts: s.scripts ?? [],
        updatedAt: s.updatedAt,
      }));
    },
  });

  // -- remove_skill -----------------------------------------------------------

  const removeSkillTool = defineTool({
    name: "remove_skill",
    group: "Skills",
    description:
      "Uninstall a skill by name. Removes it from disk and unloads it from all agents.",
    parameters: z.object({
      name: z.string().describe("The skill name to remove"),
    }),
    execute: async ({ name }) => {
      const result = await adapter.removeSkill(name);
      unloadFromAgents(name);
      return result;
    },
  });

  // -- read_skill_file --------------------------------------------------------

  const readSkillFileTool = defineTool({
    name: "read_skill_file",
    group: "Skills",
    description:
      "Read a file from inside a skill's directory. Use this to load references, docs, " +
      'examples or assets on demand -- e.g. "references/REFERENCE.md", "docs/examples.md". ' +
      "The SKILL.md body will tell you which files are available and when to read them.",
    parameters: z.object({
      skill: z.string().describe('Skill name, e.g. "azure-devops"'),
      path: z
        .string()
        .describe(
          'Relative path within the skill directory, e.g. "docs/reference.md"',
        ),
    }),
    execute: async ({ skill, path }) => {
      return adapter.readSkillFile(skill, path);
    },
  });

  // -- ToolSet -----------------------------------------------------------------

  const managerToolSet: ToolSet = {
    symbol: SKILL_MANAGER_SYMBOL,
    name: "skill-manager",
    coreTools: ["list_skills"],
    tools: [
      installSkillTool,
      listSkillsTool,
      removeSkillTool,
      readSkillFileTool,
    ],

    onAttach(agent: AgentClientLike): () => void {
      attachedAgents.push(agent);
      // Load all currently-installed skills into the newly attached agent.
      for (const {
        skill,
        resolvedTools,
        toolCleanupsByAgent,
      } of loadedSkills.values()) {
        toolCleanupsByAgent.set(
          agent,
          resolvedTools.map((t) => agent.registerTool(t)),
        );
        void skill;
      }
      return () => {
        const idx = attachedAgents.indexOf(agent);
        if (idx !== -1) attachedAgents.splice(idx, 1);
        // Unload skill tools for this agent only.
        for (const entry of loadedSkills.values()) {
          const cleanups = entry.toolCleanupsByAgent.get(agent);
          if (cleanups) {
            for (const fn of cleanups) fn();
            entry.toolCleanupsByAgent.delete(agent);
          }
        }
      };
    },

    onGetSystemPrompt(
      _ctx: ToolSetContext,
      { userMessage }: SystemPromptContext,
    ): string | undefined {
      const parts: string[] = [];
      for (const { skill } of loadedSkills.values()) {
        if (!skill.systemPrompt) continue;
        // Headless / programmatic call: always inject all skills.
        if (userMessage === undefined) {
          parts.push(skill.systemPrompt);
          continue;
        }
        // Only inject when the skill is explicitly mentioned via /skillname.
        const mentions = parseSlashMentions(userMessage);
        if (mentions.includes(skill.name)) {
          parts.push(skill.systemPrompt);
        }
      }
      return parts.length ? parts.join("\n\n") : undefined;
    },

    onGetSymbolState(_ctx: ToolSetContext) {
      const skills: SkillState[] = [...loadedSkills.values()].map(
        ({ skill, resolvedTools }) => ({
          name: skill.name,
          description: skill.description,
          version: skill.version,
          toolCount: resolvedTools.length,
          toolNames: resolvedTools.map((t) => t.name),
        }),
      );
      const btn: ToolButtonSlotDeclaration = {
        type: "toolButton",
        label: "Skills",
        icon: "🎞️",
        order: 30,
        showBtn: (ctx) => ctx.conversationId === MAIN_CONVERSATION_ID,
        badge: () => {
          const count = loadedSkills.size;
          return count > 0 ? `${count}` : null;
        },
      };
      const auto: AutocompleteSlotDeclaration = {
        type: "autocomplete",
        prefix: "/",
        getItems: () =>
          [...loadedSkills.values()].map(({ skill }) => ({
            id: skill.name,
            label: "/" + skill.name,
            description: skill.description,
            insertText: "/" + skill.name + " ",
          })),
      };
      const card: ToolCardSlotDeclaration = {
        type: "toolCard",
        toolNames: [
          "install_skill",
          "list_skills",
          "remove_skill",
          "read_skill_file",
        ],
      };
      const compact: CompactToolCardSlotDeclaration = {
        type: "compactToolCard",
        toolNames: [
          "install_skill",
          "list_skills",
          "remove_skill",
          "read_skill_file",
        ],
        getDescriptor: skillDescriptor,
      };
      return {
        type: "skillManager" as const,
        skills,
        sync: syncSkills,
        slots: [btn, auto, card, compact],
      };
    },

    onRemoveSession(ctx: ToolSetContext): void {
      subscribers.delete(ctx.sessionId);
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      let s = subscribers.get(ctx.sessionId);
      if (!s) {
        s = new Set();
        subscribers.set(ctx.sessionId, s);
      }
      s.add(fn);
      return () => s!.delete(fn);
    },
  };

  return managerToolSet;
}
