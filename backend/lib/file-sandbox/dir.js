/**
 * Directory listing and file search inside the sandbox.
 *
 * sandboxListDir(path, maxDepth?)    — list directory tree
 * sandboxSearch(pattern, content?, maxResults?)  — glob + content search
 */

import { join, relative } from 'path';
import { readdir, stat } from 'fs/promises';
import { MAX_BYTES } from './config.js';
import { isIgnoredDir } from './config.js';
import { sandboxPath, SandboxNotFoundError } from './path-security.js';

// We read activeRoot from path-security via sandboxPath — no direct import needed.
// But for `sandboxSearch` we need the raw root to build relative paths.
let _getRootFn;
export function _setGetRoot(fn) { _getRootFn = fn; }
function activeRoot() { return _getRootFn(); }

// ── List directory ────────────────────────────────────────────────────────────

/**
 * List directory contents, optionally recursing up to `maxDepth` levels.
 * Returns a tree of `{ name, type, size?, children? }` nodes.
 */
export async function sandboxListDir(path, maxDepth = 1) {
  const abs = sandboxPath(path === '' || path == null ? '.' : path);

  const info = await stat(abs).catch(() => { throw new SandboxNotFoundError(path || '/'); });
  if (!info.isDirectory()) throw new Error(`not a directory: ${path}`);

  return _buildTree(abs, 0, maxDepth);
}

async function _buildTree(absDir, depth, maxDepth) {
  const entries = await readdir(absDir, { withFileTypes: true });
  const items = await Promise.all(
    entries
      .filter(e => {
        if (e.name === '.agent') return true;
        return !e.name.startsWith('.') && !(e.isDirectory() && isIgnoredDir(e.name));
      })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(async (entry) => {
        const node = { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' };
        if (entry.isFile()) {
          const s = await stat(join(absDir, entry.name));
          node.size = s.size;
        }
        if (entry.isDirectory() && depth < maxDepth - 1) {
          node.children = await _buildTree(join(absDir, entry.name), depth + 1, maxDepth);
        }
        return node;
      }),
  );
  return items;
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Search for files matching a glob-like pattern and optionally filter by content.
 *
 * @param {string} pattern       - Simple glob: `*` within a segment, `**` across.
 * @param {string|null} contentRegex - Regex to filter by file content.
 * @param {number} maxResults    - Cap on number of results (default 50).
 * @param {object} options
 * @param {boolean} options.caseSensitive  - Whether the content regex is case-sensitive (default false).
 * @param {number}  options.contextLines   - Lines before/after each match to include (default 0).
 * @param {'files'|'content'|'count'} options.outputMode - Output format (default 'files').
 *
 * Returns:
 *   outputMode='files'   → string[]  (workspace-relative file paths)
 *   outputMode='content' → { file, line, content, context }[]
 *   outputMode='count'   → number
 *
 * Edge case: if contentRegex is absent and outputMode='content', degrades to 'files' silently.
 */
export async function sandboxSearch(pattern, contentRegex, maxResults = 50, options = {}) {
  const { caseSensitive = false, contextLines = 0, outputMode = 'files' } = options;

  // Degrade 'content' to 'files' when no content regex is supplied — there's
  // nothing to extract context from without matching lines.
  const effectiveMode = (outputMode === 'content' && !contentRegex) ? 'files' : outputMode;

  const regexFlags = 'g' + (caseSensitive ? '' : 'i');
  const regex = contentRegex ? new RegExp(contentRegex, regexFlags) : null;
  const root = activeRoot();

  if (effectiveMode === 'count') {
    const fileList = [];
    await _walk(root, root, pattern, regex ? new RegExp(contentRegex, caseSensitive ? '' : 'i') : null, fileList, maxResults);
    return fileList.length;
  }

  if (effectiveMode === 'files') {
    // Use single-match regex (no 'g') for file filtering.
    const filterRegex = contentRegex ? new RegExp(contentRegex, caseSensitive ? 'm' : 'im') : null;
    const results = [];
    await _walk(root, root, pattern, filterRegex, results, maxResults);
    return results;
  }

  // outputMode === 'content'
  const fileList = [];
  const filterRegex = new RegExp(contentRegex, caseSensitive ? 'm' : 'im');
  await _walk(root, root, pattern, filterRegex, fileList, maxResults);

  const matches = [];
  for (const relPath of fileList) {
    const abs = join(root, relPath);
    const text = await import('fs/promises').then(m => m.readFile(abs, 'utf8')).catch(() => null);
    if (!text) continue;
    const lines = text.split('\n');
    const matchRegex = new RegExp(contentRegex, regexFlags);
    let match;
    while ((match = matchRegex.exec(text)) !== null) {
      // Find which line this match is on.
      const before = text.slice(0, match.index);
      const lineIndex = before.split('\n').length - 1; // 0-based
      const lineNum = lineIndex + 1; // 1-based
      const ctxStart = Math.max(0, lineIndex - contextLines);
      const ctxEnd = Math.min(lines.length - 1, lineIndex + contextLines);
      const context = lines.slice(ctxStart, ctxEnd + 1);
      matches.push({
        file: relPath,
        line: lineNum,
        content: lines[lineIndex] ?? '',
        context,
      });
      // Avoid infinite loop on zero-length matches.
      if (match[0].length === 0) matchRegex.lastIndex++;
    }
  }
  return matches;
}

/** Convert a simple glob string to a RegExp. */
function _globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\x00')
    .replace(/\*\*/g, '\x01')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00/g, '(?:.+/)?')
    .replace(/\x01/g, '.*');
  return new RegExp(`^${escaped}$`);
}

async function _walk(root, dir, pattern, contentRegex, results, maxResults) {
  if (results.length >= maxResults) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && isIgnoredDir(entry.name)) continue;

    const abs = join(dir, entry.name);
    const rel = relative(root, abs).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      await _walk(root, abs, pattern, contentRegex, results, maxResults);
    } else if (entry.isFile()) {
      const patternRe = _globToRegex(pattern);
      if (!patternRe.test(rel) && !patternRe.test(entry.name)) continue;

      if (contentRegex) {
        const s = await stat(abs);
        if (s.size > MAX_BYTES) continue;
        const { readFile } = await import('fs/promises');
        const text = await readFile(abs, 'utf8').catch(() => null);
        if (!text || !contentRegex.test(text)) continue;
      }

      results.push(rel);
    }
  }
}
