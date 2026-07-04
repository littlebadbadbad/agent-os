import {
  createAgentClient,
  createTodoTools,
  createExperienceTools,
  createToolSearchToolSet,
  createPermissionsToolSet,
  createFileTools,
  createTerminalToolSet,
  createCronToolSet,
  createToolStateToolSet,
  createDynamicToolset,
  createSkillToolset,
  createMcpToolset,
  createSubAgentToolset,
  createTokenBudgetToolSet,
  createVariableToolSet,
  createMemoryGraphToolSet,
  createUserInputToolSet,
  createPendingInputToolSet,
  createPlanToolSet,
  createUpgradeToolSet,
  createToolResultCompressorToolSet,
  createDelegationNudgeToolSet,
} from "@agent-sdk";
import { defineTool } from "@agent-type/defineTool";
import { createPluginSystem } from "./plugin";
import type { AgentPluginContext } from "./plugin/host";
import { z } from "zod";
import { asyncHandler } from "./handlers/asyncHandler";
import { streamHandler } from "./handlers/streamHandler";
import { providerStore } from "./store/providerStore";
import { providerConfigStore } from "./store/providerConfigStore";
import {
  fileAdapter,
  terminalAdapter,
  cronAdapter,
  dynamicToolAdapter,
  skillAdapter,
  mcpAdapter,
  upgradeAdapter,
  sessionStore,
} from "./createAdapters";
import { createDefaultUIRenderer } from "./defaultRenderUI";

// ── Plugin system ──────────────────────────────────────────────────────────────
// Initialised after agent creation so plugins can register tools on sessions.

export const pluginSystem = createPluginSystem();

/**
 * Combined AgentPluginContext that registers tools on BOTH agents.
 * This lets pluginSystem.init() be called once while wiring tools
 * into both the stream and async agents simultaneously.
 */
function createCombinedPluginContext(): AgentPluginContext {
  // Use getters so these work regardless of module evaluation order.
  const ctx: AgentPluginContext = {
    addToolSet: (ts) => {
      const unsub1 = streamAgent.registerToolSet(ts);
      const unsub2 = asyncAgent.registerToolSet(ts);
      return () => { unsub1(); unsub2(); };
    },
    getRegisteredToolSets: () => {
      // Union — both agents share most tools, but deduplicate by name.
      const names = new Set<string>();
      return [
        ...streamAgent.getRegisteredToolSets(),
        ...asyncAgent.getRegisteredToolSets(),
      ].filter((ts) => {
        if (names.has(ts.name)) return false;
        names.add(ts.name);
        return true;
      });
    },
    getTools: () => {
      // Union — merge both agents' tools, deduplicate by name.
      const names = new Set<string>();
      return [
        ...streamAgent.getTools(),
        ...asyncAgent.getTools(),
      ].filter((t) => {
        if (names.has(t.name)) return false;
        names.add(t.name);
        return true;
      });
    },
    agentName: 'stream+async',
  };
  return ctx;
}

const SYSTEM_PROMPT = "";

// Restore persisted sessions from the backend.

// ── Shared tools ──────────────────────────────────────────────────────────────
// Defined before agent creation so they can be passed via `tools:` config.

const getCurrentTime = defineTool({
  name: "get_current_time",
  group: "Utilities",
  description:
    "Get the current date and time (useful for setting iteration dates and deadlines).",
  parameters: z.object({
    timezone: z
      .string()
      .optional()
      .describe('IANA timezone, e.g. "Asia/Shanghai". Defaults to UTC.'),
  }),
  execute: async ({ timezone }) => {
    const now = new Date();
    return {
      time: now.toLocaleString("en-US", {
        timeZone: timezone ?? "UTC",
        dateStyle: "full",
        timeStyle: "long",
      }),
      iso: now.toISOString(),
      date: now.toISOString().slice(0, 10),
      timezone: timezone ?? "UTC",
    };
  },
});

const fileTools = createFileTools(fileAdapter);
const todoToolSet = createTodoTools();
const experienceToolSet = createExperienceTools();
const terminalToolSet = createTerminalToolSet(terminalAdapter);
const cronToolSet = createCronToolSet(cronAdapter);
const toolStateToolSet = createToolStateToolSet();

// Token budget ToolSet — reads the current provider's context window lazily at
// session/turn time, so switching models automatically takes effect.
const tokenBudgetToolSet = createTokenBudgetToolSet(() => {
  const { contextWindow } = providerStore.getSelectedModel();
  return contextWindow
    ? {
        maxTokens: contextWindow,
        warningThreshold: 0.7,
        summarizationThreshold: 0.85,
      }
    : undefined;
});

const variableToolSet = createVariableToolSet();
const toolResultCompressorToolSet = createToolResultCompressorToolSet({ keepRecentResults: 3 });
const delegationNudgeToolSet = createDelegationNudgeToolSet();
const memoryGraphToolSet = createMemoryGraphToolSet();
const upgradeToolSet = createUpgradeToolSet({
  adapter: upgradeAdapter,
});

const sharedTools = [getCurrentTime, ...fileTools];

// Dynamic tools (create_tool / list_dynamic_tools / update_tool / delete_tool)
export const dynamicToolset = createDynamicToolset(dynamicToolAdapter);

// Skills (install_skill / list_skills / remove_skill / read_skill_file)
export const skillToolset = createSkillToolset(skillAdapter);

// MCP servers (list / add / remove / enable / disable / reload)
export const mcpToolset = createMcpToolset(mcpAdapter);

// Sub-agent meta-tools — each handler variant gets its own set.
// The tool pool is derived lazily from each agent's live registered tools.
const asyncSubAgentToolset = createSubAgentToolset("async", {
  withVariables: true,
});
const streamSubAgentToolset = createSubAgentToolset("stream", {
  withVariables: true,
});
const userInputToolset = createUserInputToolSet();
const pendingInputToolSet = createPendingInputToolSet();
const toolSearchToolSet = createToolSearchToolSet();

// ── Permission rules ──────────────────────────────────────────────────────────
// Terminal: high-risk shell patterns → ask before executing.
// Git write ops: always ask.  git_discard is additionally blocked by the
// adapter because it is irreversible.

/** Patterns in terminal_send `text` that need a confirmation prompt. */
const DANGEROUS_TERMINAL_RE = new RegExp(
  [
    '\\brm\\s+-[^\\s]*[rR]',          // rm -rf / rm -r
    '\\brm\\s+--recursive\\b',        // rm --recursive
    '\\bdd\\b.*\\bof=',               // dd of=... (disk overwrite)
    '\\bchmod\\s+(777|a\\+w|o\\+w)\\b', // world-writable chmod
    '\\bchown\\b.*\\s+-[rR]\\b',      // recursive chown
    '\\bsudo\\s+rm\\b',               // sudo rm
    '\\bsudo\\s+dd\\b',               // sudo dd
    '\\bcurl\\b[^|]+\\|\\s*(ba)?sh\\b', // curl | bash
    '\\bwget\\b[^|]+\\|\\s*(ba)?sh\\b', // wget | bash
    '\\bformat\\b|\\bmkfs\\b|\\bdiskpart\\b', // disk format
    '\\b(drop|truncate)\\s+(table|database)\\b', // DB destructive
    '\\bgit\\s+push\\s+(--force|-f)\\b', // force push
    '\\bgit\\s+reset\\s+--hard\\b',   // hard reset
    '\\bgit\\s+clean\\s+-[^-]*[fF]',  // git clean -f
  ].join('|'),
  'i',
);

const permissionsToolSet = createPermissionsToolSet({
  context: {
    mode: 'default',
    alwaysAllowRules: {
      // Read-only git ops never need a prompt.
      'git_status': 'allow',
      'git_diff':   'allow',
      'git_log':    'allow',
      // Terminal inspection is safe.
      'terminal_list':  'allow',
      'terminal_read':  'allow',
      'terminal_wait':  'allow',
      'terminal_sleep': 'allow',
    },
    alwaysDenyRules: {},
    // git_discard requires a second confirmation gate on top of the in-tool prompt.
    alwaysAskRules: {
      'git_discard': 'ask',
    },
  },
  adapter: {
    async checkPermission(toolName, args, _tool, _ctx) {
      // ── Terminal: block high-risk shell commands ──────────────────────────
      if (toolName === 'terminal_send') {
        const text = typeof args['text'] === 'string' ? args['text'] : '';
        if (DANGEROUS_TERMINAL_RE.test(text)) {
          return {
            behavior: 'ask',
            message:
              `⚠️ The command appears to be potentially destructive:\n\n` +
              `\`\`\`\n${text.slice(0, 500)}\n\`\`\`\n\n` +
              `Do you want to allow this command to run?`,
          };
        }
        return { behavior: 'allow' };
      }

      // ── Git: gate discard behind an extra confirmation ────────────────────
      if (toolName === 'git_discard') {
        const paths = Array.isArray(args['paths']) ? (args['paths'] as string[]).join(', ') : '(unknown)';
        return {
          behavior: 'ask',
          message: `⚠️ git_discard will permanently discard unstaged changes in: ${paths}. Allow?`,
        };
      }

      // ── Read-only git & terminal tools: always allow ──────────────────────
      const ALWAYS_ALLOW = new Set([
        'git_status', 'git_diff', 'git_log',
        'terminal_list', 'terminal_read', 'terminal_wait', 'terminal_sleep',
      ]);
      if (ALWAYS_ALLOW.has(toolName)) return { behavior: 'allow' };

      // ── Everything else: default allow ────────────────────────────────────
      return { behavior: 'allow' };
    },
  },
});
const planToolset = createPlanToolSet();
const sharedToolSets = [
  pendingInputToolSet,
  userInputToolset,
  toolSearchToolSet,
  permissionsToolSet,
  toolStateToolSet,
  todoToolSet,
  experienceToolSet,
  terminalToolSet,
  cronToolSet,
  tokenBudgetToolSet,
  toolResultCompressorToolSet,
  variableToolSet,
  planToolset,
  memoryGraphToolSet,
  dynamicToolset,
  skillToolset,
  mcpToolset,
  upgradeToolSet,
  delegationNudgeToolSet,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a debounced onSessionsChange handler that batches normal saves
 * (2 s) but writes immediately when `force=true` (e.g. before a restart).
 */
function makeDebouncedSave(agentId: string, delayMs = 2000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (sessions: Parameters<typeof sessionStore.saveSessions>[1], force?: boolean): void | Promise<void> => {
    if (force) {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      return sessionStore.saveSessions(agentId, sessions);
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; sessionStore.saveSessions(agentId, sessions); }, delayMs);
  };
}

// ── Agents (created without initial sessions) ───────────────────────────────────

export const asyncAgent = createAgentClient({
  id: "async-agent",
  handler: asyncHandler,
  systemPrompt: SYSTEM_PROMPT,
  toolSets: [...sharedToolSets, asyncSubAgentToolset],
  tools: sharedTools,
  onSessionsChange: makeDebouncedSave('async-agent'),
  renderUI: createDefaultUIRenderer({
    icon: "⚡",
    theme: {
      primaryColor: "#0078d4",
      primaryDarkColor: "#005fa3",
      primaryDeepColor: "#003a6e",
      primaryLightColor: "#50e6ff",
    },
    initialWidth: 520,
  }),
});

export const streamAgent = createAgentClient({
  id: "stream-agent",
  handler: streamHandler,
  systemPrompt: SYSTEM_PROMPT,
  toolSets: [...sharedToolSets, streamSubAgentToolset],
  tools: sharedTools,
  onSessionsChange: makeDebouncedSave('stream-agent'),
  renderUI: createDefaultUIRenderer({
    icon: "🌊",
    theme: {
      primaryColor: "#57C8F2",
      primaryDarkColor: "#2EA8D5",
      primaryDeepColor: "#1A7EA3",
      primaryLightColor: "#A8E4F8",
    },
    initialWidth: 520,
  }),
});

export async function initSessions(): Promise<void> {
  // Initialise plugin system FIRST so plugins register their ToolSets
  // BEFORE session restore (plugged tools appear in restored sessions).
  await pluginSystem.init(createCombinedPluginContext());
  // Load provider config before anything else
  await providerConfigStore.load();

  const [asyncSessions, streamSessions] = await Promise.all([
    sessionStore.loadSessions("async-agent"),
    sessionStore.loadSessions("stream-agent"),
  ]);
  if (asyncSessions.length > 0) asyncAgent.restoreSessions(asyncSessions);
  if (streamSessions.length > 0) streamAgent.restoreSessions(streamSessions);
}
