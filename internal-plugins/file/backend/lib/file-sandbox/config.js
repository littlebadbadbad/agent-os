/**
 * Sandbox configuration constants.
 */

/** Maximum file size for reads and writes (bytes). 2 MB by default. */
export const MAX_BYTES = parseInt(process.env.FILE_MAX_BYTES ?? '2097152', 10);

export const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.pnpm', '.yarn', 'vendor', 'Pods', '__pypackages__',
  'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.output',
  '.turbo', '.expo', 'target', 'bin', 'obj',
  '.git', '.svn', '.hg', '.idea', '.vscode',
  '.cache', '.parcel-cache', '.eslintcache', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', 'tmp', 'temp', '.tmp',
]);

if (process.env.FILE_IGNORE_DIRS) {
  for (const name of process.env.FILE_IGNORE_DIRS.split(',')) {
    const trimmed = name.trim();
    if (trimmed) DEFAULT_IGNORE_DIRS.add(trimmed);
  }
}

export function isIgnoredDir(name) {
  return DEFAULT_IGNORE_DIRS.has(name);
}

export const BLOCKED_WRITE_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.bash', '.zsh',
  '.dll', '.so', '.dylib', '.bin',
]);
