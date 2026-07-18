/**
 * Core file operations inside the sandbox.
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
  const end = Math.min(total, endLine ?? total);
  return {
    content: lines.slice(start - 1, end).join('\n'),
    startLine: start,
    endLine: end,
    totalLines: total,
    size: info.size,
  };
}

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
  if (count > 1) throw new Error(`oldStr matches ${count} locations \u2014 make it more specific`);
  const updatedLf = content.replace(normOld, normNew);
  const restored = usesCrlf ? updatedLf.replace(/\n/g, '\r\n') : updatedLf;
  await writeFile(abs, hasBom ? '\uFEFF' + restored : restored, 'utf8');
  return { replaced: 1 };
}

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
  const restored = usesCrlf ? updatedLf.replace(/\n/g, '\r\n') : updatedLf;
  await writeFile(abs, hasBom ? '\uFEFF' + restored : restored, 'utf8');
  return { replaced: count };
}

export async function sandboxDelete(path) {
  const abs = await sandboxRealPath(path);
  const info = await stat(abs).catch(() => { throw new SandboxNotFoundError(path); });
  if (!info.isFile()) throw new Error(`not a file: ${path}`);
  await unlink(abs);
  return { deleted: path };
}

export async function sandboxMove(srcPath, destPath) {
  const src = await sandboxRealPath(srcPath);
  const dest = sandboxPath(destPath);
  const info = await stat(src).catch(() => { throw new SandboxNotFoundError(srcPath); });
  if (!info.isFile()) throw new Error(`source is not a file: ${srcPath}`);
  await mkdir(dirname(dest), { recursive: true });
  await rename(src, dest);
  return { moved: { from: srcPath, to: destPath } };
}
