/**
 * scripts/runtime.mjs  —  Shared local-runtime helpers
 *
 * Used by start.mjs and build-*.mjs so both get identical behaviour.
 *
 * Exports
 * ───────
 *   ROOT              — absolute project root
 *   LOCAL_BIN         — node_modules/.bin/
 *
 *   buildEnv()        — env object: process.env ∪ .env file, with
 *                       node_modules/.bin/ prepended to PATH
 *   run(cmd, opts?)   — execSync wrapper using buildEnv() + shell:true so that
 *                       .cmd shims (Windows) and bare binary names resolve
 */

import { execSync, execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { delimiter, join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT      = resolve(__dirname, '..');
export const LOCAL_BIN = join(ROOT, 'node_modules', '.bin');

// ── .env loader ───────────────────────────────────────────────────────────────

/**
 * Parse a .env file into a plain object.
 * - Lines starting with # are comments.
 * - Optional surrounding single/double quotes are stripped from values.
 * - Existing process.env values are NOT overridden (process wins).
 */
function loadDotEnv() {
  const envFile = join(ROOT, '.env');
  if (!existsSync(envFile)) return {};
  const vars = {};
  for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    vars[key] = val.replace(/^(['"])(.*)\1$/, '$2'); // strip surrounding quotes
  }
  return vars;
}

// ── buildEnv() ────────────────────────────────────────────────────────────────

/**
 * Merge .env vars into process.env (process.env wins on conflicts).
 * Call this at the top of long-lived scripts so that subsequent reads of
 * process.env.FOO pick up values from the .env file.
 */
export function applyDotEnv() {
  for (const [k, v] of Object.entries(loadDotEnv())) {
    if (!(k in process.env)) process.env[k] = v;
  }
}

/**
 * Returns a copy of `process.env` enriched with:
 *   - Variables from .env (process.env wins on conflicts)
 *   - PATH prepended with LOCAL_BIN (node_modules/.bin)
 *
 * Called fresh on every run() so it always reflects the current process.env.
 */
export function buildEnv() {
  const dotenv = loadDotEnv();
  const base   = { ...dotenv, ...process.env }; // process.env takes priority
  // On Windows, the PATH variable name is case-insensitive and may be stored
  // as 'Path', 'PATH', 'path', etc.  Spreading process.env preserves the actual
  // casing, but then base.PATH may be undefined if the OS uses a different case.
  // Find the correct key so we never lose the system PATH.
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
  base[pathKey] = [LOCAL_BIN, base[pathKey] ?? ''].join(delimiter);
  return base;
}

// ── run() ─────────────────────────────────────────────────────────────────────

/**
 * Run a shell command using the enriched environment.
 *
 * shell:true is intentional — it lets Windows .cmd shims in node_modules/.bin/
 * resolve correctly, and bare tool names (esbuild, vite, pkg, concurrently …)
 * are found via the PATH injected by buildEnv().
 */
export function run(cmd, opts = {}) {
  console.log(`\n▶  ${cmd}`);
  execSync(cmd, { stdio: 'inherit', shell: true, cwd: ROOT, env: buildEnv(), ...opts });
}

// ── Toolchain discovery (VS, Python) ──────────────────────────────────────────

/**
 * Auto-detect the Visual C++ tools directory for node-gyp / electron-rebuild.
 *
 * Resolution order:
 *   1. VCINSTALLDIR environment variable (set by VS Developer Command Prompt)
 *   2. vswhere.exe — Microsoft's official VS locator
 *   3. Common installation paths (2026/18/2022/2019/2017 × BuildTools/Professional/Enterprise/Community)
 *
 * Notes:
 *   - VS 2026 toolset v18 may reside under `18\` (numeric) or `2026\` (year).
 *   - Both directory names are scanned.
 *
 * Returns the VC directory path, or null if nothing was found.
 */
export function resolveVcInstallDir() {
  // Already set by VS Developer Command Prompt
  if (process.env.VCINSTALLDIR) return process.env.VCINSTALLDIR;

  // Try vswhere (Microsoft's official VS locator)
  try {
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (existsSync(vswhere)) {
      const output = execFileSync(vswhere, ['-latest', '-property', 'installationPath'], {
        encoding: 'utf8',
        timeout: 10000,
      }).trim();
      if (output) {
        const candidate = join(output, 'VC');
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch { /* vswhere unavailable or failed */ }

  // Scan common VS installation paths
  const pfX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vsDirs   = ['2026', '18', '2022', '2019', '2017'];
  const editions = ['BuildTools', 'Professional', 'Enterprise', 'Community'];
  for (const dir of vsDirs) {
    for (const edition of editions) {
      const candidate = join(pfX86, 'Microsoft Visual Studio', dir, edition, 'VC');
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Auto-detect a Python interpreter for node-gyp.
 *
 * Resolution order:
 *   1. GYP_PYTHON environment variable
 *   2. PYTHON environment variable
 *   3. `where python` on PATH
 *
 * Returns the absolute path to python.exe, or null if nothing was found.
 */
export function resolveGypPython() {
  if (process.env.GYP_PYTHON) return process.env.GYP_PYTHON;
  if (process.env.PYTHON) return process.env.PYTHON;

  try {
    const out = execFileSync('where', ['python'], { encoding: 'utf8', timeout: 5000 });
    const match = out.split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0);
    if (match) return match;
  } catch { /* python not on PATH */ }

  return null;
}


