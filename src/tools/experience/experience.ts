import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { ToolSet, ToolSetContext } from '@agent-type';
import { ctxKey, MAIN_CONVERSATION_ID } from '@agent-sdk/tools/toolSet';
import { buildExperienceSectionContent, EXPERIENCE_SECTION_ID } from './prompt';

// ── Module augmentation ───────────────────────────────────────────────────────

declare module '@agent-type' {
  interface AgentSessionExtension {
    experiences?: readonly ExperienceItem[];
    /** Singleton handle for the UI layer — identical reference across all sessions. */
    experienceStore?: ExperienceStore;
  }
}

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Experience entries to preload for this session. */
    experiences?: ExperienceItem[];
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A structured experience record optimised for LLM consumption.
 *
 * Fields are machine-oriented. Text can use any language, notation, pseudocode,
 * symbolic expressions, or key=value encoding — human readability is irrelevant.
 * The system prompt injects these records in a dense tagged format before each turn.
 */
export type ExperienceItem = {
  id: string;
  createdAt: string;
  /**
   * Activation condition: the minimal context signature that makes this entry
   * applicable to the current task. Prefer entity.state=value notation.
   *
   * @example "REST.status=429; Retry-After∈response.headers"
   * @example "TypeScript.strict=true; implicit_any in callback param pos=0"
   * @example "git.push; branch=protected; no_force_push_permission"
   */
  trigger: string;
  /**
   * Actionable conclusion: the rule, pattern, or behaviour to apply.
   * Pseudocode and symbolic notation preferred over prose.
   *
   * @example "sleep(ms=int(Retry-After)*1000); retry(max=3, backoff=exp(base=1s,factor=2,jitter=true))"
   * @example "add explicit type annotation; never cast to any; prefer unknown+narrowing"
   */
  insight: string;
  /**
   * Causal chain: WHY the insight holds (optional).
   * <=2 sentences. Omit when the cause is self-evident from trigger+insight.
   *
   * @example "naive_retry->quota_exhaustion; header gives exact wait duration"
   */
  evidence?: string;
  /**
   * Reliability score 0.0-1.0 (omit = 1.0 assumed).
   * 1.0 = verified multiple times | 0.8 = strong pattern | 0.6 = single observation | 0.4 = hypothesis
   */
  confidence?: number;
  tags?: readonly string[];
};

/** Input shape for creating or patching an experience entry. */
export type ExperienceInput = {
  trigger: string;
  insight: string;
  evidence?: string;
  confidence?: number;
  tags?: string[];
};

/**
 * UI-facing mutation interface for the experience store.
 * Singleton — identical reference across all sessions and React renders.
 */
export type ExperienceStore = {
  add(input: ExperienceInput): ExperienceItem;
  update(id: string, patch: Partial<ExperienceInput>): boolean;
  remove(id: string): boolean;
  /** Serialise all experiences to a JSON string for export or backup. */
  exportJSON(): string;
  /** Parse and merge a JSON string (array or `{ experiences: [] }` envelope) into the store. Deduplicates by ID. */
  importJSON(json: string): { imported: number; skipped: number };
  /** Write the exported JSON to the system clipboard. */
  copyToClipboard(): Promise<void>;
  /** Read from the system clipboard and merge as JSON. */
  importFromClipboard(): Promise<{ imported: number; skipped: number }>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Zod schema ────────────────────────────────────────────────────────────────

const experienceInputSchema = z.object({
  trigger: z
    .string()
    .min(1)
    .describe(
      'Activation condition: minimal context signature that makes this entry applicable.\n' +
      'Prefer entity.state=value notation. Be precise, not verbose.\n' +
      'Examples:\n' +
      '  "REST.status=429; Retry-After in response.headers"\n' +
      '  "TypeScript.strict=true; implicit_any in callback param"\n' +
      '  "git.push; branch=protected; no_force_push_permission"',
    ),
  insight: z
    .string()
    .min(1)
    .describe(
      'Actionable conclusion: the rule or pattern to apply. Pseudocode preferred.\n' +
      'Examples:\n' +
      '  "sleep(ms=int(Retry-After)*1000); retry(max=3,backoff=exp(base=1s,factor=2,jitter=true))"\n' +
      '  "add explicit type; never cast to any; prefer unknown+narrowing"\n' +
      '  "open PR -> request force-push OR rebase to feature branch"',
    ),
  evidence: z
    .string()
    .optional()
    .describe(
      'Causal chain: WHY the insight holds. <=2 sentences. ' +
      'Omit when cause is self-evident from trigger+insight.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Reliability 0.0-1.0. ' +
      '1.0=verified_multiple | 0.8=strong_pattern | 0.6=single_observation | 0.4=hypothesis. ' +
      'Omit to default to 1.0.',
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe('Domain/topic tags for retrieval filtering, e.g. ["typescript", "api", "git"].'),
});

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the built-in experience ToolSet.
 *
 * Provides four tools: `experience_add`, `experience_update`, `experience_delete`,
 * `experience_list`. All recorded entries are injected into the system prompt as
 * a dense machine-readable block before every turn so the agent can pattern-match
 * against past experience without an explicit read call.
 *
 * State isolation per agent scope:
 *   sessionId                   -> root agent
 *   `${sessionId}:${agentName}` -> each sub-agent
 */
export function createExperienceTools(): ToolSet {
  // ── Global shared state ──────────────────────────────────────────────────────
  // All sessions share one experience pool — experiences are cross-session and permanent.
  // Sub-agents are excluded from both tool access and system-prompt injection.
  const globalItems: ExperienceItem[] = [];
  const globalSubs = new Set<() => void>();

  function notify(): void {
    globalSubs.forEach((fn) => fn());
  }

  /** Merge incoming items into the global pool, deduplicating by ID. */
  function mergeItems(incoming: ExperienceItem[]): { imported: number; skipped: number } {
    const existingIds = new Set(globalItems.map((e) => e.id));
    let imported = 0;
    let skipped = 0;
    for (const item of incoming) {
      if (existingIds.has(item.id)) { skipped++; } else { globalItems.push(item); imported++; }
    }
    if (imported > 0) notify();
    return { imported, skipped };
  }

  function buildItem(input: ExperienceInput): ExperienceItem {
    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString().slice(0, 10),
      trigger: input.trigger,
      insight: input.insight,
      ...(input.evidence   !== undefined && { evidence: input.evidence }),
      ...(input.confidence !== undefined && { confidence: input.confidence }),
      ...(input.tags?.length             && { tags: input.tags }),
    };
  }

  // ── Singleton store handle exposed to the UI layer ──────────────────────────

  const globalStore: ExperienceStore = {
    add(input) {
      const item = buildItem(input);
      globalItems.push(item);
      notify();
      return item;
    },
    update(id, patch) {
      const item = globalItems.find((e) => e.id === id);
      if (!item) return false;
      if (patch.trigger    !== undefined) item.trigger = patch.trigger;
      if (patch.insight    !== undefined) item.insight = patch.insight;
      if (patch.evidence   !== undefined) item.evidence = patch.evidence;
      if (patch.confidence !== undefined) item.confidence = patch.confidence;
      if (patch.tags !== undefined) {
        (item as { tags?: readonly string[] }).tags =
          patch.tags.length > 0 ? patch.tags : undefined;
      }
      notify();
      return true;
    },
    remove(id) {
      const idx = globalItems.findIndex((e) => e.id === id);
      if (idx === -1) return false;
      globalItems.splice(idx, 1);
      notify();
      return true;
    },
    exportJSON() {
      return JSON.stringify(globalItems, null, 2);
    },
    importJSON(json) {
      const parsed: unknown = JSON.parse(json);
      const incoming = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as Record<string, unknown>)['experiences'])
          ? ((parsed as Record<string, unknown>)['experiences'] as unknown[])
          : [];
      return mergeItems(incoming as ExperienceItem[]);
    },
    async copyToClipboard() {
      await navigator.clipboard.writeText(globalStore.exportJSON());
    },
    async importFromClipboard() {
      const text = await navigator.clipboard.readText();
      return globalStore.importJSON(text);
    },
  };

  // ── experience_add ────────────────────────────────────────────────────────

  const experienceAdd = defineTool({
    name: 'experience_add',
    group: 'Experience',
    description:
      'Persist a trigger→insight experience record.\n' +
      'trigger: activation condition (entity.state=value notation). ' +
      'insight: actionable rule (pseudocode preferred). ' +
      'evidence: causal chain, ≤2 sentences (optional). ' +
      'confidence: 1.0=verified | 0.8=strong | 0.6=single_obs | 0.4=hypothesis (default 1.0). ' +
      'tags: domain labels for filtering.',
    parameters: experienceInputSchema,
    execute: async ({ trigger, insight, evidence, confidence, tags }) => {
      const item = buildItem({ trigger, insight, evidence, confidence, tags });
      globalItems.push(item);
      notify();
      return { success: true, id: item.id, total: globalItems.length };
    },
  });

  // ── experience_update ─────────────────────────────────────────────────────

  const experienceUpdate = defineTool({
    name: 'experience_update',
    group: 'Experience',
    description: 'Update fields of an existing experience entry by ID. Omit any field to keep it unchanged.',
    parameters: z.object({
      id:         z.string().describe('ID of the experience entry to update (full UUID).'),
      trigger:    experienceInputSchema.shape.trigger.optional(),
      insight:    experienceInputSchema.shape.insight.optional(),
      evidence:   experienceInputSchema.shape.evidence,
      confidence: experienceInputSchema.shape.confidence,
      tags:       experienceInputSchema.shape.tags,
    }),
    execute: async ({ id, trigger, insight, evidence, confidence, tags }) => {
      const item = globalItems.find((e) => e.id === id);
      if (!item) return { success: false, error: `Experience "${id}" not found.` };
      if (trigger    !== undefined) item.trigger = trigger;
      if (insight    !== undefined) item.insight = insight;
      if (evidence   !== undefined) item.evidence = evidence;
      if (confidence !== undefined) item.confidence = confidence;
      if (tags !== undefined) {
        (item as { tags?: readonly string[] }).tags = tags.length > 0 ? tags : undefined;
      }
      notify();
      return { success: true, id };
    },
  });

  // ── experience_delete ─────────────────────────────────────────────────────

  const experienceDelete = defineTool({
    name: 'experience_delete',
    group: 'Experience',
    description: 'Permanently remove an experience entry by ID.',
    parameters: z.object({
      id: z.string().describe('Full UUID of the experience entry to remove.'),
    }),
    execute: async ({ id }) => {
      const idx = globalItems.findIndex((e) => e.id === id);
      if (idx === -1) return { success: false, error: `Experience "${id}" not found.` };
      globalItems.splice(idx, 1);
      notify();
      return { success: true, remaining: globalItems.length };
    },
  });

  // ── experience_list ───────────────────────────────────────────────────────

  const experienceList = defineTool({
    name: 'experience_list',
    group: 'Experience',
    description: 'List stored experience entries, optionally filtered by tag. Full entries are already in the system prompt — use this only to get IDs for update/delete.',
    parameters: z.object({
      tag: z.string().optional().describe('Return only entries that include this tag.'),
    }),
    execute: async ({ tag }) => {
      let items = globalItems;
      if (tag) items = items.filter((e) => e.tags?.includes(tag));
      return {
        experiences: items.slice(),
        total: items.length,
      };
    },
  });

  // ── ToolSet ───────────────────────────────────────────────────────────────

  return {
    name: 'experience',
    coreTools: ['experience_add', 'experience_list'],
    sectionId: EXPERIENCE_SECTION_ID,
    sectionPriority: 50,
    tools: [experienceAdd, experienceUpdate, experienceDelete, experienceList],

    // Sub-agents do not have access to experience tools.
    onFilterTools(ctx, tools) {
      if (ctx.conversationId !== MAIN_CONVERSATION_ID) {
        return tools.filter((t) => !t.name.startsWith('experience_'));
      }
      return tools;
    },

    // Sub-agents do not receive experience injections.
    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      if (ctx.conversationId !== MAIN_CONVERSATION_ID) return undefined;
      return buildExperienceSectionContent(globalItems);
    },

    // Merge persisted experiences into the global pool on session load.
    // ID-based deduplication handles concurrent session initialisation safely.
    onInit(_ctx: ToolSetContext, entryData): void {
      if (entryData?.experiences?.length) {
        mergeItems(entryData.experiences);
      }
    },

    // Experiences are global and permanent — session removal and history resets do not affect them.

    onGetState(_ctx: ToolSetContext) {
      return {
        experiences: globalItems,
        experienceStore: globalStore,
      };
    },

    onSubscribe(_ctx: ToolSetContext, fn: () => void): () => void {
      globalSubs.add(fn);
      return () => globalSubs.delete(fn);
    },

    // Write the global experience pool into every session snapshot.
    // On reload, whichever session initialises first repopulates the pool via mergeItems;
    // subsequent sessions deduplicate by ID, so all sessions converge to the same state.
    onBuildSnapshot(_ctx: ToolSetContext) {
      return globalItems.length ? { experiences: [...globalItems] } : {};
    },
  };
}
