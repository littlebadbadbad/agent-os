/**
 * Core file operations inside the sandbox.
 *
 * sandboxRead(path, startLine?, endLine?)      — read a text file
 * sandboxWrite(path, content)                   — create or overwrite a file
 * sandboxStrReplace(path, oldStr, newStr)       — precise string replacement
 * sandboxDelete(path)                           — delete a file
 * sandboxMove(srcPath, destPath)                — rename / move a file
 */

import { extname, dirname } from 'path';
import { readFile, writeFile, mkdir, unlink, rename, stat } from 'fs/promises';
import { MAX_BYTES, BLOCKED_WRITE_EXTENSIONS } from './config.js';
import {
  sandboxPath,
  sandboxRealPath,
  SandboxNotFoundError,
  SandboxTooLargeError,
} from './path-security.js';

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read a text file. Returns `{ content, totalLines, size }` (or with line
 * range: `{ content, startLine, endLine, totalLines, size }`).
 * @param {string} path  Workspace-relative or absolute (within sandbox) path.
 * @param {number} [startLine]  1-based, inclusive.
 * @param {number} [endLine]    1-based, inclusive.
 */
export async function sandboxRead(path, startLine, endLine) {
  const abs = await sandboxRealPath(path);

  const info = await stat(abs).catch(() => { throw new SandboxNotFoundError(path); });
  if (!info.isFile()) throw new SandboxNotFoundError(path);
  if (info.size > MAX_BYTES) throw new SandboxTooLargeError(path, info.size);

  const raw = await readFile(abs, 'utf8');

  if (startLine == null && endLine == null) {
    return { content: raw, totalLines: raw.split('\n').length, size: info.size };
  }

  const lines = raw.split('\n');
  const total = lines.length;
  const start = Math.max(1, startLine ?? 1);
  const end   = Math.min(total, endLine ?? total);
  return {
    content: lines.slice(start - 1, end).join('\n'),
    startLine: start,
    endLine: end,
    totalLines: total,
    size: info.size,
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Write (create or overwrite) a text file.
 * Automatically creates parent directories.
 */
export async function sandboxWrite(path, content) {
  const abs = sandboxPath(path);

  const ext = extname(abs).toLowerCase();
  if (BLOCKED_WRITE_EXTENSIONS.has(ext)) {
    throw new Error(`writing "${ext}" files is not allowed`);
  }

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_BYTES) throw new SandboxTooLargeError(path, bytes);

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  return { written: bytes };
}

/**
 * Write (create or overwrite) a binary file from a base64-encoded string.
 * Automatically creates parent directories.
 * @param {string} path  Workspace-relative path.
 * @param {string} base64Data  Raw base64-encoded content (no data-URI prefix).
 */
export async function sandboxWriteBinary(path, base64Data) {
  const abs = sandboxPath(path);

  const ext = extname(abs).toLowerCase();
  if (BLOCKED_WRITE_EXTENSIONS.has(ext)) {
    throw new Error(`writing "${ext}" files is not allowed`);
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > MAX_BYTES) throw new SandboxTooLargeError(path, buffer.length);

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buffer);
  return { written: buffer.length };
}

// ── Str-replace ───────────────────────────────────────────────────────────────

/**
 * Apply a precise string replacement inside a file.
 * Fails if `oldStr` is not found, or appears more than once.
 * Preserves original line endings (CRLF or LF) and BOM.
 */
export async function sandboxStrReplace(path, oldStr, newStr) {
  const abs = await sandboxRealPath(path);
  const info = await stat(abs).catch(() => { throw new SandboxNotFoundError(path); });
  if (!info.isFile()) throw new SandboxNotFoundError(path);
  if (info.size > MAX_BYTES) throw new SandboxTooLargeError(path, info.size);

  const raw = await readFile(abs, 'utf8');

  const hasBom = raw.startsWith('\uFEFF');
  const rawNoBom = hasBom ? raw.slice(1) : raw;
  const usesCrlf = rawNoBom.includes('\r\n');

  const content = rawNoBom.replace(/\r\n/g, '\n');
  const normOld = oldStr.replace(/\r\n/g, '\n');
  const normNew = newStr.replace(/\r\n/g, '\n');

  const count = content.split(normOld).length - 1;
  if (count === 0) throw new Error('oldStr not found in file');
  if (count > 1)   throw new Error(`oldStr matches ${count} locations — make it more specific`);

  const updatedLf = content.replace(normOld, normNew);
  const restored  = usesCrlf ? updatedLf.replace(/\n/g, '\r\n') : updatedLf;
  await writeFile(abs, hasBom ? '\uFEFF' + restored : restored, 'utf8');
  return { replaced: 1 };
}

/**
 * Replace ALL occurrences of oldStr with newStr in a file.
 * Unlike sandboxStrReplace, this does NOT require oldStr to be unique.
 */
export async function sandboxStrReplaceAll(path, oldStr, newStr) {
  const abs = await sandboxRealPath(path);
  const info = await stat(abs).catch(() => { throw new SandboxNotFoundError(path); });
  if (!info.isFile()) throw new SandboxNotFoundError(path);
  if (info.size > MAX_BYTES) throw new SandboxTooLargeError(path, info.size);

  const raw = await readFile(abs, 'utf8');

  const hasBom = raw.startsWith('\uFEFF');
  const rawNoBom = hasBom ? raw.slice(1) : raw;
  const usesCrlf = rawNoBom.includes('\r\n');

  const content = rawNoBom.replace(/\r\n/g, '\n');
  const normOld = oldStr.replace(/\r\n/g, '\n');
  const normNew = newStr.replace(/\r\n/g, '\n');

  const count = content.split(normOld).length - 1;
  if (count === 0) throw new Error('oldStr not found in file');

  const updatedLf = content.split(normOld).join(normNew);
  const restored  = usesCrlf ? updatedLf.replace(/\n/g, '\r\n') : updatedLf;
  await writeFile(abs, hasBom ? '\uFEFF' + restored : restored, 'utf8');
  return { replaced: count };
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Delete a file inside the sandbox. */
export async function sandboxDelete(path) {
  const abs = await sandboxRealPath(path);
  const info = await stat(abs).catch(() => { throw new SandboxNotFoundError(path); });
  if (!info.isFile()) throw new Error(`not a file: ${path}`);
  await unlink(abs);
  return { deleted: path };
}

// ── Move ──────────────────────────────────────────────────────────────────────

/** Move / rename a file inside the sandbox. */
export async function sandboxMove(srcPath, destPath) {
  const src  = await sandboxRealPath(srcPath);
  const dest = sandboxPath(destPath);

  const info = await stat(src).catch(() => { throw new SandboxNotFoundError(srcPath); });
  if (!info.isFile()) throw new Error(`source is not a file: ${srcPath}`);

  await mkdir(dirname(dest), { recursive: true });
  await rename(src, dest);
  return { moved: { from: srcPath, to: destPath } };
}
