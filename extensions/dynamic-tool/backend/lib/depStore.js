/**
 * extensions/dynamic-tool/backend/lib/depStore.js — npm dependency management
 */

import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const IS_WIN = process.platform === 'win32';
const INSTALL_TIMEOUT_MS = 120_000;
const PKG_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9-._^~*<>=]+)?$/i;
const FILE_SPEC_RE = /^file:[^;&|`$<>"']+$/;

function validatePackageNames(packages) {
  const invalid = packages.filter(p => !PKG_NAME_RE.test(p) && !FILE_SPEC_RE.test(p));
  if (invalid.length > 0) {
    throw new Error(`Invalid package name(s): ${invalid.join(', ')}`);
  }
}

function resolvePnpm() {
  return IS_WIN
    ? { cmd: 'pnpm.cmd', baseArgs: [], shell: true }
    : { cmd: 'pnpm', baseArgs: [], shell: false };
}

export function createDepStore(toolEnv) {
  const SCRIPTS_DIR = toolEnv.TOOL_SCRIPTS_DIR;

  function listDeps() {
    const pkgPath = join(SCRIPTS_DIR, 'package.json');
    if (!existsSync(pkgPath)) return { dependencies: {}, devDependencies: {} };
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return {
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
      };
    } catch {
      return { dependencies: {}, devDependencies: {} };
    }
  }

  function installDeps(packages) {
    return new Promise((resolve) => {
      validatePackageNames(packages);
      const { cmd, baseArgs, shell } = resolvePnpm();
      const args = [...baseArgs, 'add', ...packages];
      const chunks = [];
      const child = execFile(cmd, args, {
        cwd: SCRIPTS_DIR,
        shell,
        timeout: INSTALL_TIMEOUT_MS,
        env: { ...process.env, NODE_ENV: undefined },
      }, (err) => {
        const output = chunks.join('');
        if (err) {
          return resolve({ success: false, packages: [], output });
        }
        resolve({ success: true, packages, output });
      });
      child.stdout?.on('data', (c) => chunks.push(c.toString()));
      child.stderr?.on('data', (c) => chunks.push(c.toString()));
    });
  }

  function removeDep(pkg) {
    return new Promise((resolve) => {
      const { cmd, baseArgs, shell } = resolvePnpm();
      const args = [...baseArgs, 'remove', pkg];
      const chunks = [];
      const child = execFile(cmd, args, {
        cwd: SCRIPTS_DIR,
        shell,
        timeout: INSTALL_TIMEOUT_MS,
      }, (err) => {
        const output = chunks.join('');
        if (err) return resolve({ success: false, output });
        resolve({ success: true, output });
      });
      child.stdout?.on('data', (c) => chunks.push(c.toString()));
      child.stderr?.on('data', (c) => chunks.push(c.toString()));
    });
  }

  return { listDeps, installDeps, removeDep };
}
