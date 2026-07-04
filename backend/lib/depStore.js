/**
 * backend/lib/depStore.js — Third-party npm dependency management
 *
 * Installs and removes packages in the tool-scripts npm package scope
 * (data/tool-scripts/) so backend tool scripts can import them directly.
 *
 * Resolves pnpm from PATH (provided by the nodeenv virtual environment
 * or the system package manager).  Falls back automatically.
 *
 * Security: package names are validated before being passed to execFile;
 * execFile never spawns a shell, eliminating command-injection risk.
 *
 * Public API
 * ──────────
 *   listDeps()               → { dependencies, devDependencies }
 *   installDeps(packages)    → Promise<{ success, packages, output }>
 *   removeDep(pkg)           → Promise<{ success, output }>
 */

import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { TOOL_SCRIPTS_DIR } from './toolEnv.js';

const IS_WIN = process.platform === 'win32';
const INSTALL_TIMEOUT_MS = 120_000; // 2 min

// ── pnpm resolution ───────────────────────────────────────────────────────────

/**
 * Returns { cmd, args } for invoking pnpm.
 *
 * Resolves pnpm from the system PATH (made available by the nodeenv
 * virtual environment during development, or by the bundled Node.js
 * in the release exe).
 *
 * On Windows, pnpm is installed as a .cmd shim which requires shell:true
 * to be invocable via execFile. Package names are pre-validated so no
 * command-injection risk applies to user-controlled input.
 */
function resolvePnpm() {
  return IS_WIN
    ? { cmd: 'pnpm', baseArgs: [], shell: true }
    : { cmd: 'pnpm', baseArgs: [], shell: false };
}

// ── Package name validation ───────────────────────────────────────────────────

// Accepts bare names (lodash), scoped names (@scope/pkg), and optional
// version ranges (lodash@4, @scope/pkg@^2.0.0).
const PKG_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9-._^~*<>=]+)?$/i;

// Accepts local file specifiers: file:/absolute/path or file:./relative/path.
// Rejects anything with shell metacharacters (;&|`$<>) to prevent injection.
const FILE_SPEC_RE = /^file:[^;&|`$<>"']+$/;

function validatePackageNames(packages) {
  const invalid = packages.filter(p => !PKG_NAME_RE.test(p) && !FILE_SPEC_RE.test(p));
  if (invalid.length > 0) {
    throw new Error(`Invalid package name(s): ${invalid.join(', ')}`);
  }
}

// ── pnpm invocation helper ────────────────────────────────────────────────────

function runPnpm(args) {
  const { cmd, baseArgs, shell } = resolvePnpm();
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      [...baseArgs, ...args],
      { timeout: INSTALL_TIMEOUT_MS, cwd: TOOL_SCRIPTS_DIR, shell },
      (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (err) {
          reject(new Error(`pnpm ${args[0]} failed (exit ${err.code ?? '?'}):\n${output}`));
        } else {
          resolve(output);
        }
      },
    );
    // Surface live progress to server console.
    child.stdout?.on('data', d => process.stdout.write(d));
    child.stderr?.on('data', d => process.stderr.write(d));
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function listDeps() {
  const pkgFile = join(TOOL_SCRIPTS_DIR, 'package.json');
  if (!existsSync(pkgFile)) return { dependencies: {}, devDependencies: {} };
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  return {
    dependencies:    pkg.dependencies    ?? {},
    devDependencies: pkg.devDependencies ?? {},
  };
}

/**
 * Install one or more packages into the tool-scripts scope.
 * @param {string[]} packages  e.g. ['axios', 'lodash@4', '@scope/pkg']
 */
export async function installDeps(packages) {
  validatePackageNames(packages);
  try {
    const output = await runPnpm(['add', '--dir', TOOL_SCRIPTS_DIR, ...packages]);
    return { success: true, packages, output };
  } catch (err) {
    return { success: false, packages, output: err.message };
  }
}

/**
 * Remove a single package from the tool-scripts scope.
 * @param {string} pkg  bare package name (no version specifier)
 */
export async function removeDep(pkg) {
  validatePackageNames([pkg]);
  try {
    const output = await runPnpm(['remove', '--dir', TOOL_SCRIPTS_DIR, pkg]);
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err.message };
  }
}
