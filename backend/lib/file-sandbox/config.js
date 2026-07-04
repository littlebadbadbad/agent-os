/**
 * Sandbox configuration constants.
 *
 * MAX_BYTES              — maximum file size for reads and writes.
 * BLOCKED_WRITE_EXTENSIONS — extensions that can never be written.
 * DEFAULT_IGNORE_DIRS    — directory names excluded from list/search results.
 * isIgnoredDir(name)     — returns true when a dir should be skipped.
 */

/** Maximum file size for reads and writes (bytes). 2 MB by default. */
export const MAX_BYTES = parseInt(process.env.FILE_MAX_BYTES ?? '2097152', 10);

/**
 * Directory names that are always excluded from `list` and `search` results.
 *
 * Extend via the FILE_IGNORE_DIRS env var (comma-separated):
 *   FILE_IGNORE_DIRS=coverage,storybook-static
 */
export const DEFAULT_IGNORE_DIRS = new Set([
  // ── Package managers / dependencies ──────────────────────────────────────
  'node_modules', '.pnpm', '.yarn', 'vendor', 'Pods', '__pypackages__',

  // ── Build / compile output ────────────────────────────────────────────────
  'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.output',
  '.turbo', '.expo', 'target', 'bin', 'obj',

  // ── VCS & IDE internals ───────────────────────────────────────────────────
  '.git', '.svn', '.hg', '.idea', '.vscode',

  // ── Cache / temp ──────────────────────────────────────────────────────────
  '.cache', '.parcel-cache', '.eslintcache', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', 'tmp', 'temp', '.tmp',
]);

if (process.env.FILE_IGNORE_DIRS) {
  for (const name of process.env.FILE_IGNORE_DIRS.split(',')) {
    const trimmed = name.trim();
    if (trimmed) DEFAULT_IGNORE_DIRS.add(trimmed);
  }
}

/** Returns true when a directory entry should be skipped entirely. */
export function isIgnoredDir(name) {
  return DEFAULT_IGNORE_DIRS.has(name);
}

/** Extensions that are never allowed to be written or overwritten. */
export const BLOCKED_WRITE_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.bash', '.zsh',
  '.dll', '.so', '.dylib', '.bin',
]);
