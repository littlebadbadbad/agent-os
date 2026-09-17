/**
 * internal-apps/experience/agent/toolSet.ts — Experience ToolSet factory
 *
 * Provides four tools: experience_add, experience_update, experience_delete,
 * experience_list. Records are injected into the system prompt before each
 * turn so the agent can pattern-match against past experience.
 *
 * State is global (cross-session, cross-conversation). Sub-agents are
 * excluded from both tool access and system-prompt injection.
 *
 * Key design:
 *  - Symbol-isolated state via onGetSymbolState (modern pattern)
 *  - Global in-memory pool with session-snapshot persistence
 *  - UI panel + toolCard slots rendered in sandboxed iframe
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { ToolSet, ToolSetContext, Tool, ToolCallInfo, CompactToolCardDescriptor, SlotDeclaration } from '@agent-type';
import { ctxKey, MAIN_CONVERSATION_ID } from '@agent-type';
import { buildExperienceSectionContent } from './prompt';
import type { ExperienceItem, ExperienceInput, ExperienceStore, ExperienceSymbolState } from './types';

// ── Symbol ────────────────────────────────────────────────────────────────────

export const EXPERIENCE_SYMBOL = Symbol('experience');

// ── Compact tool-card descriptor ──────────────────────────────────────────────

function toolDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const ICONS: Record<string, string> = {
    experience_add: '💡',
    experience_update: '✏️',
    experience_delete: '🗑',
    experience_list: '📋',
  };
  const LABELS: Record<string, string> = {
    experience_add: 'Add',
    experience_update: 'Update',
    experience_delete: 'Delete',
    experience_list: 'List',
  };
  const icon = ICONS[info.name] ?? '💡';
  const label = LABELS[info.name] ?? info.name;
  return { icon, label, summary: '', status: info.status };
}

// ── Zod schema ────────────────────────────────────────────────────────────────

const experienceInputSchema = z.object({
  trigger: z.string().min(1).describe('Activation condition: minimal context signature. Prefer entity.state=value notation.'),
  insight: z.string().min(1).describe('Actionable rule: the pattern to apply. Pseudocode preferred.'),
  evidence: z.string().optional().describe('Causal chain: WHY the insight holds. <=2 sentences. Omit when self-evident.'),
  confidence: z.number().min(0).max(1).optional().describe('Reliability 0.0-1.0. 1.0=verified | 0.8=strong | 0.6=single_obs | 0.4=hypothesis. Default 1.0.'),
  tags: z.array(z.string()).optional().describe('Domain/topic labels for filtering.'),
});

// ── Factory ───────────────────────────────────────────────────────────────────

export function createExperienceToolSet(): ToolSet {
  const globalItems: ExperienceItem[] = [];
  const globalSubs = new Set<() => void>();

  function notify(): void {
    globalSubs.forEach((fn) => fn());
  }

  function mergeItems(incoming: ExperienceItem[]): { imported: number; skipped: number } {
    const existingIds = new Set(globalItems.map((e) => e.id));
    let imported = 0;
    let skipped = 0;
    for (const item of incoming) {
      if (existingIds.has(item.id)) {
        skipped++;
      } else {
        globalItems.push(item);
        imported++;
      }
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
      ...(input.evidence !== undefined && { evidence: input.evidence }),
      ...(input.confidence !== undefined && { confidence: input.confidence }),
      ...(input.tags?.length && { tags: input.tags }),
    };
  }

  // ── Singleton store handle (UI-layer mutation interface) ──────────────────

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
      if (patch.trigger !== undefined) item.trigger = patch.trigger;
      if (patch.insight !== undefined) item.insight = patch.insight;
      if (patch.evidence !== undefined) item.evidence = patch.evidence;
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

  // ── Tools ─────────────────────────────────────────────────────────────────

  const experienceAdd = defineTool({
    name: 'experience_add',
    group: 'Experience',
    description:
      'Persist a trigger->insight experience record. ' +
      'trigger: activation condition (entity.state=value notation). ' +
      'insight: actionable rule (pseudocode preferred). ' +
      'evidence: causal chain (optional). ' +
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

  const experienceUpdate = defineTool({
    name: 'experience_update',
    group: 'Experience',
    description: 'Update fields of an existing experience entry by ID. Omit any field to keep it unchanged.',
    parameters: z.object({
      id: z.string().describe('ID of the experience entry to update.'),
      trigger: experienceInputSchema.shape.trigger.optional(),
      insight: experienceInputSchema.shape.insight.optional(),
      evidence: experienceInputSchema.shape.evidence,
      confidence: experienceInputSchema.shape.confidence,
      tags: experienceInputSchema.shape.tags,
    }),
    execute: async ({ id, trigger, insight, evidence, confidence, tags }) => {
      const item = globalItems.find((e) => e.id === id);
      if (!item) return { success: false, error: `Experience "${id}" not found.` };
      if (trigger !== undefined) item.trigger = trigger;
      if (insight !== undefined) item.insight = insight;
      if (evidence !== undefined) item.evidence = evidence;
      if (confidence !== undefined) item.confidence = confidence;
      if (tags !== undefined) {
        (item as { tags?: readonly string[] }).tags = tags.length > 0 ? tags : undefined;
      }
      notify();
      return { success: true, id };
    },
  });

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

  const experienceList = defineTool({
    name: 'experience_list',
    group: 'Experience',
    description: 'List stored experience entries, optionally filtered by tag. Use this to get IDs for update/delete.',
    parameters: z.object({
      tag: z.string().optional().describe('Return only entries that include this tag.'),
    }),
    execute: async ({ tag }) => {
      let items = globalItems;
      if (tag) items = items.filter((e) => e.tags?.includes(tag));
      return { experiences: items.slice(), total: items.length };
    },
  });

  const toolNames = ['experience_add', 'experience_update', 'experience_delete', 'experience_list'];

  const slotDeclarations: readonly SlotDeclaration[] = [
    {
      type: 'panel',
      label: 'Experience',
      showTab: (ctx) => ctx.conversationId === MAIN_CONVERSATION_ID,
      badge: () => {
        if (globalItems.length === 0) return null;
        return String(globalItems.length);
      },
    },
    {
      type: 'toolCard',
      toolNames,
    },
    {
      type: 'compactToolCard',
      toolNames,
      getDescriptor: toolDescriptor,
    },
  ] satisfies readonly SlotDeclaration[];

  // ── ToolSet interface ─────────────────────────────────────────────────────

  return {
    symbol: EXPERIENCE_SYMBOL,
    name: 'experience',
    description: 'Persistent trigger->insight experience records for pattern matching.',
    tools: [experienceAdd, experienceUpdate, experienceDelete, experienceList],

    // Sub-agents: no experience tools, no system-prompt injection.
    onFilterTools(ctx: ToolSetContext, tools: readonly Tool[]): readonly Tool[] {
      if (ctx.conversationId !== MAIN_CONVERSATION_ID) {
        return tools.filter((t) => !t.name.startsWith('experience_'));
      }
      return tools;
    },

    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      if (ctx.conversationId !== MAIN_CONVERSATION_ID) return undefined;
      return buildExperienceSectionContent(globalItems);
    },

    onInit(_ctx: ToolSetContext, entryData?: { experiences?: ExperienceItem[] }): void {
      if (entryData?.experiences?.length) {
        mergeItems(entryData.experiences);
      }
    },

    onGetSymbolState(): ExperienceSymbolState {
      return {
        type: 'experience',
        experiences: globalItems,
        experienceStore: globalStore,
      };
    },

    onSubscribe(_ctx: ToolSetContext, fn: () => void): () => void {
      globalSubs.add(fn);
      return () => globalSubs.delete(fn);
    },

    onBuildSnapshot() {
      return globalItems.length ? { experiences: [...globalItems] } : {};
    },

    slotDeclarations,
  } as ToolSet & { readonly slotDeclarations: readonly SlotDeclaration[] };
}
