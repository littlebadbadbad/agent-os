/**
 * backend/lib/paths.js — single source of truth for all filesystem locations.
 *
 * No other backend module should derive root-relative paths from scratch.
 * Add new locations here; import them wherever needed.
 *
 * ┌─ Development (backend/lib/paths.js, native ESM via `node backend/index.js`)
 * │   EXE_DIR        →  <project>/               (project root — no real exe)
 * │   PROJECT_ROOT   →  <project>/
 * │   DATA_ROOT      →  <project>/data/
 * │   AGENT_DIR      →  <project>/.agent/
 * │   PLUGINS_DIR    →  <project>/plugins/
 * │   WORKSPACE_ROOT →  <project>/workspace/     (or $WORKSPACE_ROOT)
 * │   WORKSPACE_TMP  →  <project>/workspace/tmp/
 * │   STATIC_DIR     →  <project>/dist-demo/     (absent — Vite serves instead)
 * └──────────────────────────────────────────────────────────────────────────────
 * ┌─ Release (@yao-pkg/pkg exe, CJS bundle via esbuild)
 * │   EXE_DIR        →  release/<version>/       (directory containing the exe)
 * │   PROJECT_ROOT   →  release/                 (version-agnostic mutable root)
 * │   DATA_ROOT      →  release/data/
 * │   AGENT_DIR      →  release/.agent/
 * │   PLUGINS_DIR    →  release/plugins/
 * │   WORKSPACE_ROOT →  release/workspace/       (or $WORKSPACE_ROOT)
 * │   WORKSPACE_TMP  →  release/workspace/tmp/
 * │   STATIC_DIR     →  release/<version>/dist-demo/
 * └──────────────────────────────────────────────────────────────────────────────
 * ┌─ Electron (packaged, UAP_IS_PACKAGED=1 set by electron/main.ts)
 * │   EXE_DIR        →  release/<version>/       (same layout as pkg)
 * │   PROJECT_ROOT   →  release/
 * │   DATA_ROOT      →  release/data/
 * │   AGENT_DIR      →  release/.agent/
 * │   PLUGINS_DIR    →  release/plugins/
 * │   WORKSPACE_ROOT →  release/workspace/       (or $WORKSPACE_ROOT)
 * │   WORKSPACE_TMP  →  release/workspace/tmp/
 * │   STATIC_DIR     →  release/<version>/dist-demo/  (served via HTTP, same as pkg)
 * │   SQLITE_BINDING →  <resourcesPath>/app/node_modules/better-sqlite3/…/better_sqlite3.node
 * └──────────────────────────────────────────────────────────────────────────────
 *
 * Electron sets these env vars in electron/main.ts BEFORE requiring the backend:
 *   UAP_EXE_DIR        – directory of the Electron exe (= release/<version>/ when packaged)
 *   UAP_IS_PACKAGED    – "1" when running as a packaged Electron app
 *   UAP_NATIVE_ROOT    – path to the node_modules dir containing native bindings
 */

import { join, dirname, resolve, isAbsolute } from 'path';
import { mkdirSync } from 'fs';

// ── Runtime mode ──────────────────────────────────────────────────────────────

/** True when running inside a @yao-pkg/pkg executable. */
export const IS_PKG = typeof process.pkg !== 'undefined';

/** True when running as the Electron main process. */
export const IS_ELECTRON = typeof process.versions.electron !== 'undefined';

// In esbuild/vitest transforms, __dirname may be injected as "" (empty string)
// as an ESM compatibility shim, which is useless. Prefer import.meta.dirname
// (Node.js ≥21.2) when __dirname is absent or not an absolute path.
const _dirname = (typeof __dirname === 'string' && isAbsolute(__dirname))
  ? __dirname
  : import.meta.dirname;

// ── Root anchors ──────────────────────────────────────────────────────────────

/**
 * Directory containing the server executable.
 * In Electron mode this is set via the UAP_EXE_DIR env var, which
 * electron/main.ts writes BEFORE requiring the backend bundle.
 */
export const EXE_DIR = IS_PKG
  ? dirname(process.execPath)
  : process.env.UAP_EXE_DIR          // Electron (dev or packaged) sets this
  ?? join(_dirname, '..', '..'); // backend/lib → backend → project

/** Version-agnostic mutable data root (dev: same as EXE_DIR). */
export const PROJECT_ROOT = (IS_PKG || process.env.UAP_IS_PACKAGED === '1')
  ? dirname(EXE_DIR)
  : EXE_DIR;

// ── Derived locations ─────────────────────────────────────────────────────────

/** SQLite databases, tool scripts, session JSON files. */
export const DATA_ROOT = join(PROJECT_ROOT, 'data');

/** Skills, MCP server configs, experience store, and other agent-managed state. */
export const AGENT_DIR = join(PROJECT_ROOT, '.agent');

/** Compiled plugins output directory. */
export const PLUGINS_DIR = join(PROJECT_ROOT, 'plugins');

/**
 * Default workspace root for file tools.
 * Respects $WORKSPACE_ROOT env var; always an absolute path.
 */
export const WORKSPACE_ROOT = resolve(
  process.env.WORKSPACE_ROOT ?? join(PROJECT_ROOT, 'workspace'),
);

/** Transient scratch space used during tool-script execution. */
export const WORKSPACE_TMP = join(WORKSPACE_ROOT, 'tmp');

/** Frontend static assets — present only in pkg/Electron mode (dev: served by Vite).
 *  In Electron packaged mode dist-demo lives inside resources/app/ (not next to the exe),
 *  so we derive the path from UAP_NATIVE_ROOT (resources/app/node_modules) when set. */
export const STATIC_DIR = process.env.UAP_NATIVE_ROOT
  ? join(process.env.UAP_NATIVE_ROOT, '..', 'dist-demo')
  : join(EXE_DIR, 'dist-demo');

// ── Native binding ────────────────────────────────────────────────────────────

/**
 * Absolute path to the better-sqlite3 native binding (.node file).
 *
 * Pass via spread into every `new Database(path, ...opts)` call:
 *   new Database(dbPath, ...(SQLITE_BINDING ? [{ nativeBinding: SQLITE_BINDING }] : []))
 *
 * This bypasses the `bindings` package whose __dirname-relative search cannot
 * navigate the pkg snapshot virtual filesystem, or the Electron resources tree.
 * Undefined in dev — Database resolves the binding via its normal lookup.
 */
export const SQLITE_BINDING = IS_PKG
  ? join(EXE_DIR, 'better_sqlite3.node')
  : process.env.UAP_NATIVE_ROOT
  ? join(process.env.UAP_NATIVE_ROOT, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  : undefined;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Eagerly create every mutable directory so downstream modules can assume
// they exist without adding their own mkdirSync guards for these paths.

for (const dir of [DATA_ROOT, AGENT_DIR, PLUGINS_DIR, WORKSPACE_ROOT, WORKSPACE_TMP]) {
  mkdirSync(dir, { recursive: true });
}
