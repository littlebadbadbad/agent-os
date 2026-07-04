/**
 * Tests for backend/lib/file-sandbox.js
 *
 * Uses a real temporary directory (os.tmpdir) so we test actual fs behaviour
 * without mocking — the sandbox guarantees are only meaningful when exercised
 * against a real file system.
 *
 * Covered:
 *   sandboxPath        — path safety, traversal rejection
 *   sandboxRead        — happy path, line ranges, not-found, too-large
 *   sandboxWrite       — create, overwrite, blocked extensions, too-large
 *   sandboxStrReplace  — happy path, LF/CRLF normalisation, BOM, not-found,
 *                        ambiguous match
 *   sandboxDelete      — happy path, not-found
 *   sandboxMove        — happy path, not-found
 *   sandboxListDir     — basic listing, ignores node_modules / dist / .git,
 *                        doesn't list hidden files
 *   sandboxSearch      — glob matching, content filter, ignore dirs
 *   setWorkspaceRoot   — switches root at runtime
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  setWorkspaceRoot,
  getWorkspaceRoot,
  sandboxPath,
  sandboxRead,
  sandboxWrite,
  sandboxStrReplace,
  sandboxDelete,
  sandboxMove,
  sandboxListDir,
  sandboxSearch,
  SandboxNotFoundError,
  SandboxTooLargeError,
} from '../lib/file-sandbox/index.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

let tmpRoot;
let originalRoot;

beforeEach(async () => {
  originalRoot = getWorkspaceRoot();
  tmpRoot = await mkdtemp(join(tmpdir(), 'sandbox-test-'));
  await setWorkspaceRoot(tmpRoot);
});

afterEach(async () => {
  await setWorkspaceRoot(originalRoot);
  await rm(tmpRoot, { recursive: true, force: true });
});

/** Write a file relative to the current workspace root. */
async function write(relPath, content) {
  const abs = join(tmpRoot, relPath);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

// ── sandboxPath ───────────────────────────────────────────────────────────────

describe('sandboxPath', () => {
  it('resolves a simple relative path inside the root', () => {
    const abs = sandboxPath('notes/todo.md');
    expect(abs).toBe(join(tmpRoot, 'notes', 'todo.md'));
  });

  it('strips a leading slash so it stays inside the root', () => {
    const abs = sandboxPath('/notes/todo.md');
    expect(abs).toBe(join(tmpRoot, 'notes', 'todo.md'));
  });

  it('throws on ../  traversal', () => {
    expect(() => sandboxPath('../escape')).toThrow('path escapes');
  });

  it('throws on deeply nested traversal', () => {
    expect(() => sandboxPath('a/b/../../../../../../etc/passwd')).toThrow('path escapes');
  });

  it('throws on empty string', () => {
    expect(() => sandboxPath('')).toThrow('path must be');
  });
});

// ── sandboxRead ───────────────────────────────────────────────────────────────

describe('sandboxRead', () => {
  it('reads the full file content', async () => {
    await write('hello.txt', 'Hello, world!');
    const result = await sandboxRead('hello.txt');
    expect(result.content).toBe('Hello, world!');
    expect(result.totalLines).toBe(1);
  });

  it('returns a line range when startLine/endLine are given', async () => {
    await write('multi.txt', 'line1\nline2\nline3\nline4');
    const result = await sandboxRead('multi.txt', 2, 3);
    expect(result.content).toBe('line2\nline3');
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(3);
  });

  it('clamps endLine to the actual line count', async () => {
    await write('short.txt', 'only one line');
    const result = await sandboxRead('short.txt', 1, 9999);
    expect(result.endLine).toBe(1);
  });

  it('throws SandboxNotFoundError for a missing file', async () => {
    await expect(sandboxRead('nope.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxWrite ──────────────────────────────────────────────────────────────

describe('sandboxWrite', () => {
  it('creates a new file and returns byte count', async () => {
    const result = await sandboxWrite('new.txt', 'content');
    expect(result.written).toBeGreaterThan(0);
    const read = await sandboxRead('new.txt');
    expect(read.content).toBe('content');
  });

  it('overwrites an existing file', async () => {
    await write('over.txt', 'old');
    await sandboxWrite('over.txt', 'new');
    const read = await sandboxRead('over.txt');
    expect(read.content).toBe('new');
  });

  it('creates intermediate directories automatically', async () => {
    await sandboxWrite('a/b/c/deep.txt', 'deep');
    const read = await sandboxRead('a/b/c/deep.txt');
    expect(read.content).toBe('deep');
  });

  it('throws for blocked extensions (.exe)', async () => {
    await expect(sandboxWrite('bad.exe', '')).rejects.toThrow('not allowed');
  });

  it('throws SandboxTooLargeError when content exceeds the limit', async () => {
    const huge = 'x'.repeat(2 * 1024 * 1024 + 1);
    await expect(sandboxWrite('big.txt', huge)).rejects.toBeInstanceOf(SandboxTooLargeError);
  });
});

// ── sandboxStrReplace ─────────────────────────────────────────────────────────

describe('sandboxStrReplace', () => {
  it('replaces a unique substring', async () => {
    await write('code.js', 'const x = 1;\nconst y = 2;\n');
    await sandboxStrReplace('code.js', 'const x = 1;', 'const x = 99;');
    const read = await sandboxRead('code.js');
    expect(read.content).toContain('const x = 99;');
    expect(read.content).not.toContain('const x = 1;');
  });

  it('handles a CRLF file — matches LF oldStr and preserves CRLF on write-back', async () => {
    const crlf = 'line1\r\nline2\r\nline3\r\n';
    await write('win.txt', crlf);

    await sandboxStrReplace('win.txt', 'line1\nline2', 'replaced');

    const raw = await sandboxRead('win.txt');
    // The replacement was applied
    expect(raw.content).toContain('replaced');
    // CRLF line endings are preserved for the unchanged parts
    expect(raw.content).toContain('\r\n');
  });

  it('handles a UTF-8 BOM file', async () => {
    const bom = '\uFEFFconst a = 1;\nconst b = 2;\n';
    await write('bom.js', bom);

    await sandboxStrReplace('bom.js', 'const a = 1;', 'const a = 42;');

    const read = await sandboxRead('bom.js');
    expect(read.content).toContain('\uFEFF');       // BOM preserved
    expect(read.content).toContain('const a = 42;');
  });

  it('throws when oldStr is not found', async () => {
    await write('f.txt', 'hello world');
    await expect(sandboxStrReplace('f.txt', 'not here', 'x')).rejects.toThrow('not found');
  });

  it('throws when oldStr matches multiple locations', async () => {
    await write('dup.txt', 'foo\nfoo\n');
    await expect(sandboxStrReplace('dup.txt', 'foo', 'bar')).rejects.toThrow('matches 2');
  });

  it('throws SandboxNotFoundError for a missing file', async () => {
    await expect(sandboxStrReplace('missing.txt', 'a', 'b')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxDelete ─────────────────────────────────────────────────────────────

describe('sandboxDelete', () => {
  it('deletes an existing file', async () => {
    await write('del.txt', 'bye');
    await sandboxDelete('del.txt');
    await expect(sandboxRead('del.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it('throws SandboxNotFoundError for a missing file', async () => {
    await expect(sandboxDelete('ghost.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxMove ───────────────────────────────────────────────────────────────

describe('sandboxMove', () => {
  it('moves a file to a new path', async () => {
    await write('src.txt', 'data');
    await sandboxMove('src.txt', 'dest.txt');
    const read = await sandboxRead('dest.txt');
    expect(read.content).toBe('data');
    await expect(sandboxRead('src.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it('creates intermediate directories for the destination', async () => {
    await write('flat.txt', 'data');
    await sandboxMove('flat.txt', 'nested/dir/flat.txt');
    const read = await sandboxRead('nested/dir/flat.txt');
    expect(read.content).toBe('data');
  });

  it('throws SandboxNotFoundError when source does not exist', async () => {
    await expect(sandboxMove('no.txt', 'dest.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxListDir ────────────────────────────────────────────────────────────

describe('sandboxListDir', () => {
  it('lists files and directories at depth 1', async () => {
    await write('a.txt', '');
    await write('b.txt', '');
    await mkdir(join(tmpRoot, 'subdir'), { recursive: true });

    const entries = await sandboxListDir('');
    const names = entries.map((e) => e.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('b.txt');
    expect(names).toContain('subdir');
  });

  it('excludes node_modules', async () => {
    await mkdir(join(tmpRoot, 'node_modules', 'some-pkg'), { recursive: true });
    await write('real.js', '');
    const entries = await sandboxListDir('');
    expect(entries.map((e) => e.name)).not.toContain('node_modules');
  });

  it('excludes dist', async () => {
    await mkdir(join(tmpRoot, 'dist'), { recursive: true });
    await write('src.js', '');
    const entries = await sandboxListDir('');
    expect(entries.map((e) => e.name)).not.toContain('dist');
  });

  it('excludes .git', async () => {
    await mkdir(join(tmpRoot, '.git'), { recursive: true });
    const entries = await sandboxListDir('');
    expect(entries.map((e) => e.name)).not.toContain('.git');
  });

  it('excludes hidden files (dot-prefixed)', async () => {
    await write('.env', 'SECRET=1');
    await write('visible.txt', '');
    const entries = await sandboxListDir('');
    expect(entries.map((e) => e.name)).not.toContain('.env');
    expect(entries.map((e) => e.name)).toContain('visible.txt');
  });

  it('lists nested contents when depth > 1', async () => {
    await write('src/index.js', '');
    await write('src/util.js', '');
    const entries = await sandboxListDir('', 2);
    const src = entries.find((e) => e.name === 'src');
    expect(src?.children?.map((c) => c.name)).toContain('index.js');
  });

  it('throws SandboxNotFoundError for a missing directory', async () => {
    await expect(sandboxListDir('no-such-dir')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxSearch ─────────────────────────────────────────────────────────────

describe('sandboxSearch', () => {
  it('matches files by glob pattern', async () => {
    await write('foo.ts', '');
    await write('bar.ts', '');
    await write('baz.js', '');

    const results = await sandboxSearch('**/*.ts');
    expect(results).toContain('foo.ts');
    expect(results).toContain('bar.ts');
    expect(results).not.toContain('baz.js');
  });

  it('filters by content regex', async () => {
    await write('a.txt', 'hello world');
    await write('b.txt', 'goodbye world');

    const results = await sandboxSearch('**/*.txt', 'hello');
    expect(results).toContain('a.txt');
    expect(results).not.toContain('b.txt');
  });

  it('does not descend into node_modules', async () => {
    await mkdir(join(tmpRoot, 'node_modules', 'pkg'), { recursive: true });
    await write('node_modules/pkg/index.js', 'module.exports = {}');
    await write('src.js', '');

    const results = await sandboxSearch('**/*.js');
    expect(results).not.toContain('node_modules/pkg/index.js');
    expect(results).toContain('src.js');
  });

  it('does not descend into build / dist / __pycache__', async () => {
    for (const dir of ['build', 'dist', '__pycache__']) {
      await mkdir(join(tmpRoot, dir), { recursive: true });
      await write(`${dir}/artifact.js`, '');
    }
    await write('real.js', '');

    const results = await sandboxSearch('**/*.js');
    expect(results).toContain('real.js');
    expect(results.some((r) => r.startsWith('build/'))).toBe(false);
    expect(results.some((r) => r.startsWith('dist/'))).toBe(false);
    expect(results.some((r) => r.startsWith('__pycache__/'))).toBe(false);
  });

  it('respects maxResults cap', async () => {
    for (let i = 0; i < 10; i++) await write(`f${i}.txt`, '');
    const results = await sandboxSearch('**/*.txt', null, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

// ── setWorkspaceRoot ──────────────────────────────────────────────────────────

describe('setWorkspaceRoot', () => {
  it('switches to a new root and creates the directory if absent', async () => {
    const newRoot = join(tmpdir(), `sandbox-new-${Date.now()}`);
    try {
      const result = await setWorkspaceRoot(newRoot);
      expect(result.created).toBe(true);
      expect(getWorkspaceRoot()).toBe(newRoot);
    } finally {
      await rm(newRoot, { recursive: true, force: true });
      await setWorkspaceRoot(tmpRoot); // restore for afterEach
    }
  });

  it('accepts an existing directory without creating it', async () => {
    const result = await setWorkspaceRoot(tmpRoot);
    expect(result.created).toBe(false);
  });

  it('throws when given a relative path', async () => {
    await expect(setWorkspaceRoot('relative/path')).rejects.toThrow('absolute');
  });

  it('throws when the path points to a file instead of a directory', async () => {
    const file = join(tmpRoot, 'i-am-a-file.txt');
    await writeFile(file, 'x');
    await expect(setWorkspaceRoot(file)).rejects.toThrow('not a directory');
  });
});
