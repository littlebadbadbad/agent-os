/**
 * Tests for extensions/file/backend/lib/file-sandbox/
 *
 * Uses a real temporary directory (os.tmpdir) so we test actual fs behaviour
 * without mocking.
 *
 * Covered:
 *   sandboxPath        — path safety, traversal rejection
 *   sandboxRead        — happy path, line ranges, not-found, too-large
 *   sandboxWrite       — create, overwrite, blocked extensions, too-large
 *   sandboxStrReplace  — happy path, LF/CRLF normalisation, BOM, not-found, ambiguous
 *   sandboxDelete      — happy path, not-found
 *   sandboxMove        — happy path, not-found
 *   sandboxListDir     — basic listing, ignores node_modules/dist/.git/hidden
 *   sandboxSearch      — glob matching, content filter, ignore dirs
 *   setWorkspaceRoot   — switches root at runtime
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  setWorkspaceRoot,
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
} from '../../backend/lib/file-sandbox/index.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'sandbox-test-'));
  await setWorkspaceRoot(tmpRoot);
});

afterEach(async () => {
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
    const abs = sandboxPath(tmpRoot, 'notes/todo.md');
    expect(abs).toBe(join(tmpRoot, 'notes', 'todo.md'));
  });

  it('strips a leading slash so it stays inside the root', () => {
    const abs = sandboxPath(tmpRoot, '/notes/todo.md');
    expect(abs).toBe(join(tmpRoot, 'notes', 'todo.md'));
  });

  it('throws on ../ traversal', () => {
    expect(() => sandboxPath(tmpRoot, '../escape')).toThrow('path escapes');
  });

  it('throws on deeply nested traversal', () => {
    expect(() => sandboxPath(tmpRoot, 'a/b/../../../../../../etc/passwd')).toThrow('path escapes');
  });

  it('throws on empty string', () => {
    expect(() => sandboxPath(tmpRoot, '')).toThrow('path must be');
  });
});

// ── sandboxRead ───────────────────────────────────────────────────────────────

describe('sandboxRead', () => {
  it('reads the full file content', async () => {
    await write('hello.txt', 'Hello, world!');
    const result = await sandboxRead(tmpRoot, 'hello.txt');
    expect(result.content).toBe('Hello, world!');
    expect(result.totalLines).toBe(1);
  });

  it('returns a line range when startLine/endLine are given', async () => {
    await write('multi.txt', 'line1\nline2\nline3\nline4');
    const result = await sandboxRead(tmpRoot, 'multi.txt', 2, 3);
    expect(result.content).toBe('line2\nline3');
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(3);
  });

  it('clamps endLine to the actual line count', async () => {
    await write('short.txt', 'only one line');
    const result = await sandboxRead(tmpRoot, 'short.txt', 1, 9999);
    expect(result.endLine).toBe(1);
  });

  it('throws SandboxNotFoundError for a missing file', async () => {
    await expect(sandboxRead(tmpRoot, 'nope.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxWrite ──────────────────────────────────────────────────────────────

describe('sandboxWrite', () => {
  it('creates a new file and returns byte count', async () => {
    const result = await sandboxWrite(tmpRoot, 'new.txt', 'content');
    expect(result.written).toBeGreaterThan(0);
    const read = await sandboxRead(tmpRoot, 'new.txt');
    expect(read.content).toBe('content');
  });

  it('overwrites an existing file', async () => {
    await write('over.txt', 'old');
    await sandboxWrite(tmpRoot, 'over.txt', 'new');
    const read = await sandboxRead(tmpRoot, 'over.txt');
    expect(read.content).toBe('new');
  });

  it('creates intermediate directories automatically', async () => {
    await sandboxWrite(tmpRoot, 'a/b/c/deep.txt', 'deep');
    const read = await sandboxRead(tmpRoot, 'a/b/c/deep.txt');
    expect(read.content).toBe('deep');
  });

  it('throws for blocked extensions (.exe)', async () => {
    await expect(sandboxWrite(tmpRoot, 'bad.exe', '')).rejects.toThrow('not allowed');
  });

  it('throws SandboxTooLargeError when content exceeds the limit', async () => {
    const huge = 'x'.repeat(2 * 1024 * 1024 + 1);
    await expect(sandboxWrite(tmpRoot, 'big.txt', huge)).rejects.toBeInstanceOf(SandboxTooLargeError);
  });
});

// ── sandboxStrReplace ─────────────────────────────────────────────────────────

describe('sandboxStrReplace', () => {
  it('replaces a unique substring', async () => {
    await write('code.js', 'const x = 1;\nconst y = 2;\n');
    await sandboxStrReplace(tmpRoot, 'code.js', 'const x = 1;', 'const x = 99;');
    const read = await sandboxRead(tmpRoot, 'code.js');
    expect(read.content).toContain('const x = 99;');
    expect(read.content).not.toContain('const x = 1;');
  });

  it('handles a CRLF file — matches LF oldStr and preserves CRLF on write-back', async () => {
    const crlf = 'line1\r\nline2\r\nline3\r\n';
    await write('win.txt', crlf);
    await sandboxStrReplace(tmpRoot, 'win.txt', 'line1\nline2', 'replaced');
    const raw = await sandboxRead(tmpRoot, 'win.txt');
    expect(raw.content).toContain('replaced');
    expect(raw.content).toContain('\r\n');
  });

  it('handles a UTF-8 BOM file', async () => {
    const bom = '\uFEFFconst a = 1;\nconst b = 2;\n';
    await write('bom.js', bom);
    await sandboxStrReplace(tmpRoot, 'bom.js', 'const a = 1;', 'const a = 42;');
    const read = await sandboxRead(tmpRoot, 'bom.js');
    expect(read.content).toContain('\uFEFF');
    expect(read.content).toContain('const a = 42;');
  });

  it('throws when oldStr is not found', async () => {
    await write('f.txt', 'hello world');
    await expect(sandboxStrReplace(tmpRoot, 'f.txt', 'not here', 'x')).rejects.toThrow('not found');
  });

  it('throws when oldStr matches multiple locations', async () => {
    await write('dup.txt', 'foo\nfoo\n');
    await expect(sandboxStrReplace(tmpRoot, 'dup.txt', 'foo', 'bar')).rejects.toThrow('matches 2');
  });

  it('throws SandboxNotFoundError for a missing file', async () => {
    await expect(sandboxStrReplace(tmpRoot, 'missing.txt', 'a', 'b')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxDelete ─────────────────────────────────────────────────────────────

describe('sandboxDelete', () => {
  it('deletes an existing file', async () => {
    await write('del.txt', 'bye');
    await sandboxDelete(tmpRoot, 'del.txt');
    await expect(sandboxRead(tmpRoot, 'del.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it('throws SandboxNotFoundError for a missing file', async () => {
    await expect(sandboxDelete(tmpRoot, 'ghost.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxMove ───────────────────────────────────────────────────────────────

describe('sandboxMove', () => {
  it('moves a file to a new path', async () => {
    await write('src.txt', 'data');
    await sandboxMove(tmpRoot, 'src.txt', 'dest.txt');
    const read = await sandboxRead(tmpRoot, 'dest.txt');
    expect(read.content).toBe('data');
    await expect(sandboxRead(tmpRoot, 'src.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it('creates intermediate directories for the destination', async () => {
    await write('flat.txt', 'data');
    await sandboxMove(tmpRoot, 'flat.txt', 'nested/dir/flat.txt');
    const read = await sandboxRead(tmpRoot, 'nested/dir/flat.txt');
    expect(read.content).toBe('data');
  });

  it('throws SandboxNotFoundError when source does not exist', async () => {
    await expect(sandboxMove(tmpRoot, 'no.txt', 'dest.txt')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxListDir ────────────────────────────────────────────────────────────

describe('sandboxListDir', () => {
  it('lists files and directories at depth 1', async () => {
    await write('a.txt', '');
    await write('b.txt', '');
    await mkdir(join(tmpRoot, 'subdir'), { recursive: true });

    const entries = await sandboxListDir(tmpRoot, '');
    const names = entries.map((e) => e.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('b.txt');
    expect(names).toContain('subdir');
  });

  it('excludes node_modules', async () => {
    await mkdir(join(tmpRoot, 'node_modules', 'some-pkg'), { recursive: true });
    await write('real.js', '');
    const entries = await sandboxListDir(tmpRoot, '');
    expect(entries.map((e) => e.name)).not.toContain('node_modules');
  });

  it('excludes dist', async () => {
    await mkdir(join(tmpRoot, 'dist'), { recursive: true });
    await write('src.js', '');
    const entries = await sandboxListDir(tmpRoot, '');
    expect(entries.map((e) => e.name)).not.toContain('dist');
  });

  it('excludes .git', async () => {
    await mkdir(join(tmpRoot, '.git'), { recursive: true });
    const entries = await sandboxListDir(tmpRoot, '');
    expect(entries.map((e) => e.name)).not.toContain('.git');
  });

  it('excludes hidden files (dot-prefixed)', async () => {
    await write('.env', 'SECRET=1');
    await write('visible.txt', '');
    const entries = await sandboxListDir(tmpRoot, '');
    expect(entries.map((e) => e.name)).not.toContain('.env');
    expect(entries.map((e) => e.name)).toContain('visible.txt');
  });

  it('lists nested contents when depth > 1', async () => {
    await write('src/index.js', '');
    await write('src/util.js', '');
    const entries = await sandboxListDir(tmpRoot, '', 2);
    const src = entries.find((e) => e.name === 'src');
    expect(src?.children?.map((c) => c.name)).toContain('index.js');
  });

  it('throws SandboxNotFoundError for a missing directory', async () => {
    await expect(sandboxListDir(tmpRoot, 'no-such-dir')).rejects.toBeInstanceOf(SandboxNotFoundError);
  });
});

// ── sandboxSearch ─────────────────────────────────────────────────────────────

describe('sandboxSearch', () => {
  it('matches files by glob pattern', async () => {
    await write('foo.ts', 'const x = 1;');
    await write('bar.js', 'const y = 2;');
    const result = await sandboxSearch(tmpRoot, '*.ts');
    expect(result).toContain('foo.ts');
    expect(result).not.toContain('bar.js');
  });

  it('filters by content when a regex is provided', async () => {
    await write('a.ts', 'TODO: fix me');
    await write('b.ts', 'done');
    const result = await sandboxSearch(tmpRoot, '*.ts', 'TODO');
    expect(result).toContain('a.ts');
    expect(result).not.toContain('b.ts');
  });

  it('respects ignore directories during search', async () => {
    await mkdir(join(tmpRoot, 'node_modules'), { recursive: true });
    await write('node_modules/pkg/index.js', 'module.exports = {};');
    await write('src/real.js', 'const x = 1;');
    const result = await sandboxSearch(tmpRoot, '**/*.js');
    expect(result).toContain('src/real.js');
    expect(result).not.toContain('node_modules/pkg/index.js');
  });

  it('honours the maxResults cap', async () => {
    for (let i = 0; i < 20; i++) {
      await write(`file${i}.txt`, '');
    }
    const result = await sandboxSearch(tmpRoot, '*.txt', null, 10);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});

// ── setWorkspaceRoot ──────────────────────────────────────────────────────────

describe('setWorkspaceRoot', () => {
  it('switches the active root and creates it if missing', async () => {
    const newRoot = join(tmpdir(), 'sandbox-test-new-root-' + Date.now());
    try {
      const result = await setWorkspaceRoot(newRoot);
      expect(result.root).toBe(newRoot);
      expect(result.created).toBe(true);

      // Now sandboxPath should resolve relative to the new root
      const abs = sandboxPath(newRoot, 'test.txt');
      expect(abs).toBe(join(newRoot, 'test.txt'));
    } finally {
      await rm(newRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('does not set created=true when the directory already exists', async () => {
    const result = await setWorkspaceRoot(tmpRoot);
    expect(result.root).toBe(tmpRoot);
    expect(result.created).toBe(false);
  });

  it('throws for empty path', async () => {
    await expect(setWorkspaceRoot('')).rejects.toThrow('non-empty');
  });

  it('throws for relative path', async () => {
    await expect(setWorkspaceRoot('relative/path')).rejects.toThrow('absolute');
  });
});
