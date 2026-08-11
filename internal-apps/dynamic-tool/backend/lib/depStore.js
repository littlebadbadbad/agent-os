/**
 * internal-apps/dynamic-tool/backend/lib/depStore.js — npm dependency management
 *
 * All command execution goes through the terminal app's cross-app service.
 */

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

/** @import { TerminalService } from '@agent-type/services' */

/**
 * Create the dependency store, bound to a TerminalService for command execution.
 *
 * @param {{ TOOL_SCRIPTS_DIR: string }} toolEnv
 * @param {TerminalService} terminal
 */
export function createDepStore(toolEnv, terminal) {
  const SCRIPTS_DIR = toolEnv.TOOL_SCRIPTS_DIR;

  /** Resolve the pnpm binary name for the current platform. */
  const pnpmCmd = IS_WIN ? 'pnpm.cmd' : 'pnpm';

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

  async function installDeps(packages) {
    validatePackageNames(packages);
    const result = await terminal.runCommand({
      command: pnpmCmd,
      args: ['add', ...packages],
      cwd: SCRIPTS_DIR,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    return {
      success: result.success,
      packages: result.success ? packages : [],
      output: result.output,
    };
  }

  async function removeDep(pkg) {
    const result = await terminal.runCommand({
      command: pnpmCmd,
      args: ['remove', pkg],
      cwd: SCRIPTS_DIR,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    return { success: result.success, output: result.output };
  }

  return { listDeps, installDeps, removeDep };
}
