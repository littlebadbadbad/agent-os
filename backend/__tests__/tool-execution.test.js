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
import { upsertTool, removeTool, executeTool } from '../lib/store.js';
import { upsertModule, removeModule } from '../lib/moduleStore.js';
import { installDeps, removeDep, listDeps } from '../lib/depStore.js';

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
  removeTool(TOOL_MODULE);
  removeTool(TOOL_DEP);
  removeTool(TOOL_COMBINED);
  removeModule(MODULE_NAME);
  removeModule(MODULE_COMBINED);
  // Only remove ms if this test was the one that installed it.
  const { dependencies } = listDeps();
  if (DEP_PKG in (dependencies ?? {})) {
    await removeDep(DEP_PKG);
  }
});

// ── 1. Shared-module tool ─────────────────────────────────────────────────────

describe('backend tool importing a #modules/* shared module', () => {
  it('persists the shared module to disk and DB', () => {
    upsertModule({
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
    upsertTool({
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
    const result = await executeTool(TOOL_MODULE, { text: 'Hello World! This is a Test.' });
    expect(result).toEqual({ slug: 'hello-world-this-is-a-test' });
  });

  it('re-executes correctly after the module content changes (cache-busting)', async () => {
    // Update the module to uppercase the slug — verifies each run gets fresh source.
    upsertModule({
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
    upsertTool({
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
    const result = await executeTool(TOOL_MODULE, { text: 'hello world' });
    expect(result).toEqual({ slug: 'HELLO_WORLD' });
  });
});

// ── 2. npm dependency tool ────────────────────────────────────────────────────

describe('backend tool importing a third-party npm package (ms)', () => {
  it('installs the "ms" package into the tool-scripts scope', async () => {
    const result = await installDeps([DEP_PKG]);
    expect(result.success).toBe(true);
    expect(result.packages).toContain(DEP_PKG);

    // Verify it now appears in the package.json dependencies.
    const { dependencies } = listDeps();
    expect(DEP_PKG in dependencies).toBe(true);
  }, 120_000 /* pnpm can be slow on a cold cache */);

  it('persists a tool that imports ms', () => {
    upsertTool({
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
    const result = await executeTool(TOOL_DEP, { duration });
    expect(result).toEqual({ input: duration, milliseconds: expected });
  });

  it('throws a useful error when the duration is unrecognised', async () => {
    await expect(executeTool(TOOL_DEP, { duration: 'not-a-duration' }))
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
    const result = await installDeps([`file:${MS_TGZ}`]);
    if (!result.success) throw new Error(`Failed to install ms from tarball:\n${result.output}`);
  }, 60_000);

  it('persists the test-duration-fmt shared module', () => {
    upsertModule({
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
    upsertTool({
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
      await expect(executeTool(TOOL_COMBINED, { input }))
        .rejects.toThrow('Cannot parse');
    } else {
      const result = await executeTool(TOOL_COMBINED, { input });
      expect(result).toEqual({ input, milliseconds: expectedMs, label: expectedLabel });
    }
  });
});
