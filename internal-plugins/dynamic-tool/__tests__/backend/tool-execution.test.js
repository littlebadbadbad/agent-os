/**
 * Integration tests for dynamic tool execution.
 *
 * Real files are written into a temp data directory, real SQLite rows are
 * created, and Node.js ESM modules are actually imported and executed.
 * afterAll() cleans up every artefact.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createToolStore } from '../../backend/lib/store.js';
import { createModuleStore } from '../../backend/lib/moduleStore.js';
import { createDepStore } from '../../backend/lib/depStore.js';
import { createToolEnv } from '../../backend/lib/toolEnv.js';

// ── Test data dir ─────────────────────────────────────────────────────────────

let dataDir;
let toolStore, moduleStore, depStore;
let toolEnv;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dt-exec-test-'));
  toolEnv = createToolEnv(dataDir);
  try {
    toolStore = createToolStore(dataDir, toolEnv);
    moduleStore = createModuleStore(dataDir, toolEnv);
    depStore = createDepStore(toolEnv);
  } catch (err) {
    // Skip if native modules unavailable
    console.warn('[tool-execution] better-sqlite3 not available, skipping:', err.message);
  }
});

afterAll(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

// ── Fixture identifiers ───────────────────────────────────────────────────────

const MODULE_NAME     = 'test-string-utils';
const TOOL_MODULE     = 'test_module_tool';
const TOOL_DEP        = 'test_dep_tool';
const DEP_PKG         = 'ms';

// ── 1. Shared-module tool ─────────────────────────────────────────────────────

describe('backend tool importing a #modules/* shared module', () => {
  it('persists the shared module to disk and DB', () => {
    if (!moduleStore) return;
    moduleStore.upsertModule({
      name: MODULE_NAME,
      description: 'Test helpers - slugify a string.',
      content: [
        'export function slugify(str) {',
        '  return String(str)',
        '    .toLowerCase()',
        '    .trim()',
        '    .replace(/[^a-z0-9]+/g, "-")',
        '    .replace(/^-+|-+$/g, "");',
        '}',
      ].join('\n'),
    });
  });

  it('persists the tool that imports the shared module', () => {
    if (!toolStore) return;
    toolStore.upsertTool({
      name: TOOL_MODULE,
      description: 'Returns URL slug using shared string-utils module.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      runtime: 'backend',
      implementation: [
        `import { slugify } from '#modules/${MODULE_NAME}';`,
        '',
        'export async function run(args) {',
        '  return { slug: slugify(args.text) };',
        '}',
      ].join('\n'),
    });
  });

  it('executes the tool and returns the correct slug', async () => {
    if (!toolStore) return;
    const result = await toolStore.executeTool(TOOL_MODULE, { text: 'Hello World! This is a Test.' });
    expect(result).toEqual({ slug: 'hello-world-this-is-a-test' });
  });

  it('re-executes correctly after the module content changes (cache-busting)', async () => {
    if (!moduleStore || !toolStore) return;
    moduleStore.upsertModule({
      name: MODULE_NAME,
      description: 'Test helpers - now uppercase slug.',
      content: [
        'export function slugify(str) {',
        '  return String(str)',
        '    .toUpperCase()',
        '    .trim()',
        '    .replace(/[^A-Z0-9]+/g, "_")',
        '    .replace(/^_+|_+$/g, "");',
        '}',
      ].join('\n'),
    });
    toolStore.upsertTool({
      name: TOOL_MODULE,
      description: 'Returns UPPER_SNAKE slug.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      runtime: 'backend',
      implementation: [
        `import { slugify } from '#modules/${MODULE_NAME}';`,
        '',
        'export async function run(args) {',
        '  return { slug: slugify(args.text) };',
        '}',
      ].join('\n'),
    });
    const result = await toolStore.executeTool(TOOL_MODULE, { text: 'hello world' });
    expect(result).toEqual({ slug: 'HELLO_WORLD' });
  });
});

// ── 2. npm dependency tool ────────────────────────────────────────────────────

describe('backend tool importing a third-party npm package (ms)', () => {
  it('installs the "ms" package into the tool-scripts scope', async () => {
    if (!depStore) return;
    const result = await depStore.installDeps([DEP_PKG]);
    expect(result.success).toBe(true);
    expect(result.packages).toContain(DEP_PKG);
    const { dependencies } = depStore.listDeps();
    expect(DEP_PKG in dependencies).toBe(true);
  }, 120_000);

  it('persists a tool that imports ms', () => {
    if (!toolStore) return;
    toolStore.upsertTool({
      name: TOOL_DEP,
      description: 'Parses a human-readable duration string using the ms npm package.',
      parameters: { type: 'object', properties: { duration: { type: 'string' } }, required: ['duration'] },
      runtime: 'backend',
      implementation: [
        "import ms from 'ms';",
        '',
        'export async function run(args) {',
        '  const milliseconds = ms(args.duration);',
        '  if (milliseconds === undefined) throw new Error(`Cannot parse duration: "${args.duration}"`);',
        '  return { input: args.duration, milliseconds };',
        '}',
      ].join('\n'),
    });
  });

  it.each([
    ['2 hours',   7_200_000],
    ['30m',       1_800_000],
    ['1d',       86_400_000],
    ['500ms',          500],
  ])('executes: ms("%s") === %d', async (duration, expected) => {
    if (!toolStore) return;
    const result = await toolStore.executeTool(TOOL_DEP, { duration });
    expect(result).toEqual({ input: duration, milliseconds: expected });
  });

  it('throws a useful error when the duration is unrecognised', async () => {
    if (!toolStore) return;
    await expect(toolStore.executeTool(TOOL_DEP, { duration: 'not-a-duration' }))
      .rejects.toThrow('Cannot parse duration');
  });
});
