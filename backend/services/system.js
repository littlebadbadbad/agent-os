/**
 * backend/lib/services/system.js — System-info business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here.
 */

import { basename, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { getPublicKeyPem } from '../lib/rsa.js';
import { EXE_DIR, IS_PKG, PROJECT_ROOT } from '../lib/paths.js';

export function checkHealth() {
  return { status: 'ok' };
}

export function getPublicKeyInfo() {
  return { publicKey: getPublicKeyPem() };
}

export function getAppVersion() {
  if (IS_PKG) {
    return { version: basename(EXE_DIR) };
  }
  const pkgPath = join(PROJECT_ROOT, '..', 'package.json');
  if (existsSync(pkgPath)) {
    const ver = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
    if (ver) return { version: String(ver) };
  }
  return { version: 'unknown' };
}
