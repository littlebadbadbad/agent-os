import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { VariableStore, VariableEntry } from './types';
import { isVariableHandle } from './store';
import { parsePath } from './json-path';
import { exploreNode } from './json-explore';
import { jsonTypeOf } from './json-expand';
import { generateOverview } from './json-overview';
import { analyzeJson, type ExploreStrategy } from './json-analyze';
import { walkJson } from './json-walk';

const DEFAULT_PAGE_SIZE = 20;

// ── Handle resolution ────────────────────────────────────────────────────────

function resolve(
  store: VariableStore,
  handle: string,
): { ok: true; entry: VariableEntry } | { ok: false; error: string } {
  if (!isVariableHandle(handle)) {
    return { ok: false, error: `Invalid handle format: "${handle}". Expected "$var:xxxxxxxx".` };
  }
  const entry = store.resolve(handle);
  if (!entry) {
    return { ok: false, error: `Variable "${handle}" not found.` };
  }
  return { ok: true, entry };
}

function strategyLabel(entry: VariableEntry): ExploreStrategy | undefined {
  if (entry.kind !== 'json') return undefined;
  const type = jsonTypeOf(entry.value);
  if (type !== 'object' && type !== 'array') return undefined;
  return analyzeJson(entry.value, walkJson(entry.value)).name;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export function createVariableTools(getStore: (sessionId: string) => VariableStore) {

  const varOverview = defineTool({
    name: 'var_overview',
    group: 'Variables',
    description:
      'Get a full structural overview of a variable in one call.\n' +
      'Returns: root type, size, depth/breadth, type counts, paginated root keys with size previews,\n' +
      'top-10 largest sub-fields, and a recommended strategy with a concrete action hint.\n' +
      'Always call this FIRST before drilling into a large variable.',
    parameters: z.object({
      handle: z.string().describe('Variable handle, e.g. "$var:a1b2c3d4".'),
    }),
    execute: async ({ handle }, context) => {
      const r = resolve(getStore(context.sessionId), handle);
      if (!r.ok) return { error: r.error };
      const entry = r.entry;
      if (entry.kind === 'attachment') {
        return {
          type: 'attachment',
          mimeType: entry.attachment.source === 'data' ? entry.attachment.mimeType : 'image/*',
          size: entry.size,
          hint: 'Use var_explore to retrieve this attachment inline.',
        };
      }
      return generateOverview(entry.value);
    },
  });

  const varExplore = defineTool({
    name: 'var_explore',
    group: 'Variables',
    description:
      'Navigate to any JSON path within a variable. Automatically adapts to the target type:\n' +
      '- Object / Array → paginated child list with per-child type, size, and value previews\n' +
      '- String         → paginated content (page = chunk number, pageSize = chars per chunk)\n' +
      '- Number/Boolean/Null → value returned inline\n' +
      'Call after var_overview using the strategy hint to pick the right path.',
    parameters: z.object({
      handle: z.string().describe('Variable handle, e.g. "$var:a1b2c3d4".'),
      path: z.string().optional().describe('Dot/bracket path, e.g. "results" or "items[0].name". Empty = root.'),
      page: z.number().int().min(1).optional().describe(`Page number (1-indexed). Default: 1.`),
      pageSize: z.number().int().min(1).max(100).optional().describe(
        `Children per page (objects/arrays) or chars per chunk (strings). Default: ${DEFAULT_PAGE_SIZE}.`,
      ),
    }),
    execute: async ({ handle, path = '', page = 1, pageSize = DEFAULT_PAGE_SIZE }, context) => {
      const r = resolve(getStore(context.sessionId), handle);
      if (!r.ok) return { error: r.error };
      const entry = r.entry;
      if (entry.kind === 'attachment') {
        return {
          type: 'attachment',
          mimeType: entry.attachment.source === 'data' ? entry.attachment.mimeType : 'image/*',
          size: entry.size,
          __toolAttachments__: [entry.attachment],
        };
      }
      return exploreNode(entry.value, parsePath(path), page, pageSize);
    },
  });

  const varWrite = defineTool({
    name: 'var_write',
    group: 'Variables',
    description:
      'Store a JSON value and get back a handle with its structural overview.\n' +
      'Pass valid JSON text, e.g. \'{"key":"value"}\', \'[1,2,3]\', \'"text"\', \'42\'.',
    parameters: z.object({
      json: z.string().min(1).describe('Valid JSON string to parse and store.'),
      name: z.string().optional().describe('Human-readable label.'),
    }),
    execute: async ({ json, name }, context) => {
      let value: unknown;
      try { value = JSON.parse(json); } catch (e) {
        return { error: `Invalid JSON: ${(e as Error).message}` };
      }
      const store = getStore(context.sessionId);
      const handle = store.store(
        { kind: 'json', value: value as never },
        { source: 'user', ...(name !== undefined && { name }) },
      );
      const overview = generateOverview(value as never);
      return {
        handle,
        size: overview.sizeBytes,
        sizeLabel: overview.sizeLabel,
        rootType: overview.rootType,
        strategy: overview.strategy,
        strategyHint: overview.strategyHint,
      };
    },
  });

  const varList = defineTool({
    name: 'var_list',
    group: 'Variables',
    description:
      'List all variables in the session with structural summaries.\n' +
      'JSON variables include valueType and strategy so you can prioritize which to explore first.',
    parameters: z.object({
      kind: z.enum(['json', 'attachment']).optional().describe('Filter by kind.'),
    }),
    execute: async ({ kind }, context) => {
      const store = getStore(context.sessionId);
      const entries = store.list().filter((e) => !kind || e.kind === kind);
      return {
        variables: entries.map((e) => {
          const base = {
            handle: e.handle,
            kind: e.kind,
            size: e.size,
            source: e.source,
            ...(e.name !== undefined ? { name: e.name } : {}),
            ...(e.toolName !== undefined ? { toolName: e.toolName } : {}),
          };
          if (e.kind === 'attachment') {
            return { ...base, mimeType: e.attachment.source === 'data' ? e.attachment.mimeType : 'image/*' };
          }
          return { ...base, valueType: jsonTypeOf(e.value), ...(strategyLabel(e) !== undefined && { strategy: strategyLabel(e) }) };
        }),
        total: entries.length,
      };
    },
  });

  const varDelete = defineTool({
    name: 'var_delete',
    group: 'Variables',
    description: 'Delete a variable by handle to free memory.',
    parameters: z.object({
      handle: z.string().describe('Variable handle to delete.'),
    }),
    execute: async ({ handle }, context) => {
      if (!isVariableHandle(handle)) return { error: `Invalid handle format: "${handle}".` };
      const store = getStore(context.sessionId);
      return store.delete(handle) ? { success: true } : { error: `Variable "${handle}" not found.` };
    },
  });

  return [varOverview, varExplore, varWrite, varList, varDelete] as const;
}
