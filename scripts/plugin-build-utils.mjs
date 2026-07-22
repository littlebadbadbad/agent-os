/**
 * scripts/plugin-build-utils.mjs  —  Shared build utilities for plugins.
 *
 * Each plugin's build script (extensions/<name>/scripts/build.mjs) is
 * responsible for compiling its own source files and copying manifest.json
 * plus a cleaned package.json into the output directory.  This module
 * provides shared helpers so every plugin doesn't duplicate the logic.
 *
 * Usage in a plugin build script:
 *
 *   import { copyPluginAssets } from "../../../scripts/plugin-build-utils.mjs";
 *   // ... compile entries ...
 *   copyPluginAssets(SRC_DIR, OUT_DIR);
 *
 * What copyPluginAssets copies:
 *   - manifest.json     (as-is, required for runtime plugin loading)
 *   - package.json      (with devDependencies stripped — only runtime deps)
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Copy manifest.json and a cleaned package.json from a plugin's source
 * directory to its build output directory.
 *
 * @param {string} srcDir  — Absolute path to the plugin source directory
 *                        (e.g. resolve(__dirname, "..") inside build.mjs).
 * @param {string} outDir  — Absolute path to the output directory
 *                        (e.g. PLUGIN_OUT_DIR or a default).
 */
export function copyPluginAssets(srcDir, outDir) {
  // ── manifest.json ───────────────────────────────────────────────────────
  const manifestPath = join(srcDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`  ┊  copied manifest.json → ${outDir}`);
  } else {
    console.warn(`  ⚠  no manifest.json found at ${manifestPath}`);
  }

  // ── package.json (strip devDependencies) ────────────────────────────────
  const pkgPath = join(srcDir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const { devDependencies, ...cleanPkg } = pkg;
    writeFileSync(join(outDir, "package.json"), JSON.stringify(cleanPkg, null, 2));
    console.log(`  ┊  copied package.json → ${outDir}`);
  }
}
