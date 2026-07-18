/**
 * Directory listing and file search inside the sandbox.
 */

import { join, relative } from 'path';
import { readdir, stat, readFile } from 'fs/promises';
import { MAX_BYTES, isIgnoredDir } from './config.js';
import { sandboxPath, SandboxNotFoundError } from './path-security.js';

let _getRootFn;
export function _setGetRoot(fn) { _getRootFn = fn; }
function activeRoot() { return _getRootFn(); }

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

export async function sandboxSearch(pattern, contentRegex, maxResults = 50, options = {}) {
  const { caseSensitive = false, contextLines = 0, outputMode = 'files' } = options;
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
    const filterRegex = contentRegex ? new RegExp(contentRegex, caseSensitive ? 'm' : 'im') : null;
    const results = [];
    await _walk(root, root, pattern, filterRegex, results, maxResults);
    return results;
  }

  const fileList = [];
  const filterRegex = new RegExp(contentRegex, caseSensitive ? 'm' : 'im');
  await _walk(root, root, pattern, filterRegex, fileList, maxResults);
  const matches = [];
  for (const relPath of fileList) {
    const abs = join(root, relPath);
    const text = await readFile(abs, 'utf8').catch(() => null);
    if (!text) continue;
    const lines = text.split('\n');
    const matchRegex = new RegExp(contentRegex, regexFlags);
    let match;
    while ((match = matchRegex.exec(text)) !== null) {
      const before = text.slice(0, match.index);
      const lineIndex = before.split('\n').length - 1;
      const lineNum = lineIndex + 1;
      const ctxStart = Math.max(0, lineIndex - contextLines);
      const ctxEnd = Math.min(lines.length - 1, lineIndex + contextLines);
      const context = lines.slice(ctxStart, ctxEnd + 1);
      matches.push({
        file: relPath,
        line: lineNum,
        content: lines[lineIndex] ?? '',
        context,
      });
      if (match[0].length === 0) matchRegex.lastIndex++;
    }
  }
  return matches;
}

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
        const text = await readFile(abs, 'utf8').catch(() => null);
        if (!text || !contentRegex.test(text)) continue;
      }
      results.push(rel);
    }
  }
}
