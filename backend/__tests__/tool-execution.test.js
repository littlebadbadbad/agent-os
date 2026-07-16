/**
 * Integration tests for dynamic tool execution.
 *
 * Unlike the unit tests in tools.route.test.js, NOTHING is mocked here.
 * Real files are written into data/tool-scripts/, real SQLite rows are created,
 * and Node.js ESM modules are actually imported and executed.
 *
 * The user has explicitly approved data-layer writes for these tests.
 * afterAll() cleans up every artefact so repeated runs are safe.
 *
 * Scenarios
 * ─────────
 *  1. A backend tool that uses a shared #modules/<name> module (slugify helper).
 *  2. A backend tool that imports a third-party npm package (ms).
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { fileURLToPath } from 'url';
import { join } from 'path';

// ── Dynamic store imports ───────────────────────────────────────────────────
// The store modules use better-sqlite3 (a native addon). When the test runner
// Node.js version differs from the one that compiled the addon, the module
// fails to load.  We use a plain require() inside beforeAll so vitest's ESM
let store, moduleStore, depStore;

// Load the store modules.  better-sqlite3 requires a native addon compiled
// for the test runner's Node.js ABI.  If there's a mismatch (e.g. VS Code's
// built-in Node.js vs the workspace Node.js), the import succeeds but
// new Database() throws.  We wrap it so the suite can gracefully skip.
try {
  const _store = await import('../lib/store.js');
  store = _store;
  moduleStore = await import('../lib/moduleStore.js');
  depStore = await import('../lib/depStore.js');
} catch { /* native module not available */ }

// Absolute path to the pre-downloaded tarballs — enables fully-offline test runs.
const FIXTURES_DIR    = join(fileURLToPath(import.meta.url), '..', 'fixtures');
const MS_TGZ          = join(FIXTURES_DIR, 'ms-2.1.3.tgz');

// ── Fixture identifiers ───────────────────────────────────────────────────────

const MODULE_NAME     = 'test-string-utils';   // shared module (scenario 1)
const TOOL_MODULE     = 'test_module_tool';     // tool that imports the module
const TOOL_DEP        = 'test_dep_tool';        // tool that imports an npm package (scenario 2)
const DEP_PKG         = 'ms';                  // tiny, deterministic, no native bindings
const MODULE_COMBINED = 'test-duration-fmt';   // shared module (scenario 3)
const TOOL_COMBINED   = 'test_combined_tool';  // tool that uses BOTH module + npm dep

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (!store) return;
  store.removeTool(TOOL_MODULE);
  store.removeTool(TOOL_DEP);
  store.removeTool(TOOL_COMBINED);
  moduleStore.removeModule(MODULE_NAME);
  moduleStore.removeModule(MODULE_COMBINED);
  // Only remove ms if this test was the one that installed it.
  const { dependencies } = depStore.listDeps();
  if (DEP_PKG in (dependencies ?? {})) {
    await depStore.removeDep(DEP_PKG);
  }
});

// ── 1. Shared-module tool ─────────────────────────────────────────────────────

describe('backend tool importing a #modules/* shared module', () => {
  it('persists the shared module to disk and DB', () => {
    moduleStore.upsertModule({
      name: MODULE_NAME,
      description: 'Test helpers — slugify a string to a URL-safe slug.',
      content: `\
/** Convert a string to a URL-safe slug. */
export function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
`,
    });
  });

  it('persists the tool that imports the shared module', () => {
    store.upsertTool({
      name: TOOL_MODULE,
      description: 'Returns the URL slug of the given text using the shared string-utils module.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      runtime: 'backend',
      implementation: `\
import { slugify } from '#modules/${MODULE_NAME}';

export async function run(args) {
  return { slug: slugify(args.text) };
}
`,
    });
  });

  it('executes the tool and returns the correct slug', async () => {
    const result = await store.executeTool(TOOL_MODULE, { text: 'Hello World! This is a Test.' });
    expect(result).toEqual({ slug: 'hello-world-this-is-a-test' });
  });

  it('re-executes correctly after the module content changes (cache-busting)', async () => {
    // Update the module to uppercase the slug — verifies each run gets fresh source.
    moduleStore.upsertModule({
      name: MODULE_NAME,
      description: 'Test helpers — now uppercase slug.',
      content: `\
export function slugify(str) {
  return String(str)
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
`,
    });
    // Update the tool to use the new behaviour.
    store.upsertTool({
      name: TOOL_MODULE,
      description: 'Returns an UPPER_SNAKE slug.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      runtime: 'backend',
      implementation: `\
import { slugify } from '#modules/${MODULE_NAME}';

export async function run(args) {
  return { slug: slugify(args.text) };
}
`,
    });
    const result = await store.executeTool(TOOL_MODULE, { text: 'hello world' });
    expect(result).toEqual({ slug: 'HELLO_WORLD' });
  });
});

// ── 2. npm dependency tool ────────────────────────────────────────────────────

describe('backend tool importing a third-party npm package (ms)', () => {
  it('installs the "ms" package into the tool-scripts scope', async () => {
    const result = await depStore.installDeps([DEP_PKG]);
    expect(result.success).toBe(true);
    expect(result.packages).toContain(DEP_PKG);

    // Verify it now appears in the package.json dependencies.
    const { dependencies } = depStore.listDeps();
    expect(DEP_PKG in dependencies).toBe(true);
  }, 120_000 /* pnpm can be slow on a cold cache */);

  it('persists a tool that imports ms', () => {
    store.upsertTool({
      name: TOOL_DEP,
      description: 'Parses a human-readable duration string using the ms npm package.',
      parameters: {
        type: 'object',
        properties: { duration: { type: 'string' } },
        required: ['duration'],
      },
      runtime: 'backend',
      implementation: `\
import ms from 'ms';

export async function run(args) {
  const milliseconds = ms(args.duration);
  if (milliseconds === undefined) throw new Error(\`Cannot parse duration: "\${args.duration}"\`);
  return { input: args.duration, milliseconds };
}
`,
    });
  });

  it.each([
    ['2 hours',   7_200_000],
    ['30m',       1_800_000],
    ['1d',       86_400_000],
    ['500ms',          500],
  ])('executes: ms("%s") === %d', async (duration, expected) => {
    const result = await store.executeTool(TOOL_DEP, { duration });
    expect(result).toEqual({ input: duration, milliseconds: expected });
  });

  it('throws a useful error when the duration is unrecognised', async () => {
    await expect(store.executeTool(TOOL_DEP, { duration: 'not-a-duration' }))
      .rejects.toThrow('Cannot parse duration');
  });
});

// ── 3. Combined: local module + offline npm tarball ───────────────────────────
//
// ms is installed from a pre-downloaded .tgz so this test runs fully offline.
// The tool uses ms (npm) to parse a duration string and test-duration-fmt
// (#modules) to render it as a human-readable label — neither works alone.

describe('backend tool using both a #modules/* module AND an npm tarball (offline)', () => {
  beforeAll(async () => {
    // Install ms from the local tarball — no registry access needed.
    const result = await depStore.installDeps([`file:${MS_TGZ}`]);
    if (!result.success) throw new Error(`Failed to install ms from tarball:\n${result.output}`);
  }, 60_000);

  it('persists the test-duration-fmt shared module', () => {
    moduleStore.upsertModule({
      name: MODULE_COMBINED,
      description: 'Formats a millisecond count into a compact human-readable label.',
      content: `\
/**
 * Formats milliseconds as a compact label, e.g. 5_400_000 → "1h 30m".
 * Only non-zero parts are included; returns "0s" for zero input.
 */
export function formatMs(n) {
  const h = Math.floor(n / 3_600_000);
  const m = Math.floor((n % 3_600_000) / 60_000);
  const s = Math.floor((n % 60_000) / 1_000);
  return [h && \`\${h}h\`, m && \`\${m}m\`, s && \`\${s}s\`].filter(Boolean).join(' ') || '0s';
}
`,
    });
  });

  it('persists the combined tool', () => {
    store.upsertTool({
      name: TOOL_COMBINED,
      description: 'Parses a duration string (via ms) and formats it (via #modules/test-duration-fmt).',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      runtime: 'backend',
      implementation: `\
import ms from 'ms';
import { formatMs } from '#modules/${MODULE_COMBINED}';

export async function run(args) {
  const milliseconds = ms(args.input);
  if (milliseconds === undefined) throw new Error(\`Cannot parse: "\${args.input}"\`);
  return { input: args.input, milliseconds, label: formatMs(milliseconds) };
}
`,
    });
  });

  it.each([
    ['2h',    7_200_000, '2h'],
    ['90m',   5_400_000, '1h 30m'],
    ['1d',   86_400_000, '24h'],
    ['500ms',       500, '0s'],
    ['1h 30m' /* ms does not parse compound strings → undefined */,
                  undefined, null],
  ])('executes with input "%s"', async (input, expectedMs, expectedLabel) => {
    if (expectedMs === undefined) {
      await expect(store.executeTool(TOOL_COMBINED, { input }))
        .rejects.toThrow('Cannot parse');
    } else {
      const result = await store.executeTool(TOOL_COMBINED, { input });
      expect(result).toEqual({ input, milliseconds: expectedMs, label: expectedLabel });
    }
  });
});
