import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { VariableStore, JsonValue } from './types';
import { parsePath } from './json-path';
import { expandNode, readAtPath } from './json-expand';
import { jsonTypeOf } from './json-expand';

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_LENGTH = 8_000;

export function createVariableTools(getStore: (sessionId: string) => VariableStore) {
  // ── var_expand ────────────────────────────────────────────────────────────

  const varExpand = defineTool({
    name: 'var_expand',
    group: 'Variables',
    description:
      'Browse the JSON structure of a variable like a debugger.\n' +
      'Expand the root or any path to see direct children with their types and value previews.\n' +
      'Use page/pageSize to navigate large objects or arrays.',
    parameters: z.object({
      handle: z.string().describe('Variable handle, e.g. "$var:a1b2c3d4".'),
      path: z.string().optional().describe(
        'Dot/bracket path to expand, e.g. "result.items" or "[0].name". Leave empty to expand root.',
      ),
      page: z.number().int().min(1).optional().describe('Page number (1-indexed). Defaults to 1.'),
      pageSize: z.number().int().min(1).max(100).optional().describe(
        `Items per page for objects/arrays. Defaults to ${DEFAULT_PAGE_SIZE}.`,
      ),
    }),
    execute: async ({ handle, path = '', page = 1, pageSize = DEFAULT_PAGE_SIZE }, context) => {
      const store = getStore(context.sessionId);
      const entry = store.resolve(handle as `$var:${string}`);
      if (!entry) return { error: `Variable "${handle}" not found.` };

      if (entry.kind === 'attachment') {
        return {
          path: '',
          type: 'attachment',
          mimeType: entry.attachment.source === 'data' ? entry.attachment.mimeType : 'image/*',
          size: entry.size,
          hint: 'Use var_read_path to retrieve this attachment inline (visible to vision models).',
        };
      }

      return expandNode(entry.value, parsePath(path), page, pageSize);
    },
  });

  // ── var_read_path ─────────────────────────────────────────────────────────

  const varReadPath = defineTool({
    name: 'var_read_path',
    group: 'Variables',
    description:
      'Read the value at a specific JSON path within a variable.\n' +
      'Primitives (number, boolean, null) are returned directly.\n' +
      'Strings: paginated by character offset/maxLength.\n' +
      'Objects/arrays: returns the paginated key list so you can drill deeper — use offset as page number (1-based) and maxLength as page size.',
    parameters: z.object({
      handle: z.string().describe('Variable handle, e.g. "$var:a1b2c3d4".'),
      path: z.string().optional().describe(
        'Dot/bracket path to the target value, e.g. "data.items[0].text". Leave empty for root.',
      ),
      offset: z.number().int().min(0).optional().describe(
        'For strings: 0-based character offset. For objects/arrays: 1-based page number (0 = page 1). Defaults to 0.',
      ),
      maxLength: z.number().int().min(1).max(100_000).optional().describe(
        `For strings: max characters to return. For objects/arrays: keys per page. Defaults to ${DEFAULT_MAX_LENGTH}.`,
      ),
    }),
    execute: async ({ handle, path = '', offset = 0, maxLength = DEFAULT_MAX_LENGTH }, context) => {
      const store = getStore(context.sessionId);
      const entry = store.resolve(handle as `$var:${string}`);
      if (!entry) return { error: `Variable "${handle}" not found.` };

      if (entry.kind === 'attachment') {
        // Return attachment inline so vision models can see it.
        return {
          path: '',
          type: 'attachment',
          mimeType: entry.attachment.source === 'data' ? entry.attachment.mimeType : 'image/*',
          size: entry.size,
          __toolAttachments__: [entry.attachment],
        };
      }

      return readAtPath(entry.value, parsePath(path), offset, maxLength);
    },
  });

  // ── var_write ─────────────────────────────────────────────────────────────

  const varWrite = defineTool({
    name: 'var_write',
    group: 'Variables',
    description:
      'Store a JSON value as a variable and get back a handle.\n' +
      'The `json` parameter must be a valid JSON string, e.g. \'{"key":"value"}\', \'[1,2,3]\', \'"text"\', \'42\'.\n' +
      'Use when you want to save a computed value for later use by other tools.',
    parameters: z.object({
      json: z.string().min(1).describe('Valid JSON string to parse and store.'),
      name: z.string().optional().describe('Optional human-readable label for this variable.'),
    }),
    execute: async ({ json, name }, context) => {
      let value: JsonValue;
      try {
        value = JSON.parse(json) as JsonValue;
      } catch (e) {
        return { error: `Invalid JSON: ${(e as Error).message}` };
      }
      const store = getStore(context.sessionId);
      const handle = store.store(
        { kind: 'json', value },
        { source: 'user', ...(name !== undefined && { name }) },
      );
      return { handle, size: JSON.stringify(value).length };
    },
  });

  // ── var_list ──────────────────────────────────────────────────────────────

  const varList = defineTool({
    name: 'var_list',
    group: 'Variables',
    description: 'List all variables in the current session. Returns metadata only — no content.',
    parameters: z.object({
      kind: z.enum(['json', 'attachment']).optional().describe('Filter by variable kind.'),
    }),
    execute: async ({ kind }, context) => {
      const store = getStore(context.sessionId);
      const entries = store.list().filter((e) => !kind || e.kind === kind);
      return {
        variables: entries.map((e) => {
          const meta: Record<string, unknown> = {
            handle: e.handle,
            kind: e.kind,
            size: e.size,
            source: e.source,
            ...(e.name !== undefined && { name: e.name }),
            ...(e.toolName !== undefined && { toolName: e.toolName }),
          };
          if (e.kind === 'json') {
            meta.valueType = jsonTypeOf(e.value);
          } else {
            meta.mimeType = e.attachment.source === 'data' ? e.attachment.mimeType : 'image/*';
          }
          return meta;
        }),
        total: entries.length,
      };
    },
  });

  // ── var_delete ────────────────────────────────────────────────────────────

  const varDelete = defineTool({
    name: 'var_delete',
    group: 'Variables',
    description: 'Delete a variable by handle, freeing its memory.',
    parameters: z.object({
      handle: z.string().describe('Variable handle to delete.'),
    }),
    execute: async ({ handle }, context) => {
      const store = getStore(context.sessionId);
      const deleted = store.delete(handle as `$var:${string}`);
      return { success: deleted, ...(deleted ? {} : { error: `Variable "${handle}" not found.` }) };
    },
  });

  return [varExpand, varReadPath, varWrite, varList, varDelete] as const;
}

