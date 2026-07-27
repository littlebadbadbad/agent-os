/**
 * scripts/plugin-build-utils.mjs  —  Shared build utilities for plugins.
 *
 * Two exports:
 *
 *   1. `buildPlugin(callerMetaUrl, config)`  —  One-call build for the common case.
 *      Compiles agent/backend entries (esbuild), optionally builds UI (Vite),
 *      and copies manifest.json + cleaned package.json to the output dir.
 *
 *   2. `copyPluginAssets(srcDir, outDir)`  —  Lower-level helper for plugins
 *      that need a custom build pipeline.
 *
 * Usage in a plugin build script:
 *
 *   import { buildPlugin } from "../../../scripts/plugin-build-utils.mjs";
 *   buildPlugin(import.meta.url, {
 *     pluginName: "terminal",
 *     entries: [
 *       { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
 *       { src: "backend/index.js",  out: "backend.cjs",  platform: "node"   },
 *     ],
 *     hasUi: true,
 *   });
 *
 * copyPluginAssets copies:
 *   - manifest.json     (as-is, required for runtime plugin loading)
 *   - package.json      (with devDependencies stripped)
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import esbuild from "esbuild";

// ── Per-platform defaults ─────────────────────────────────────────────────────

const DEFAULT_TARGET = { browser: "es2022", node: "node26" };
const DEFAULT_FORMAT = { browser: "esm", node: "cjs" };
const DEFAULT_EXTERNAL = {
  browser: [],
  node: ["@agent-type", "@agent-sdk"],
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * One-call build for the common plugin pattern.
 *
 * @param {string} callerMetaUrl  — Pass `import.meta.url` from the calling script.
 * @param {object} config
 * @param {string} config.pluginName   — Human-readable name for log messages.
 * @param {Array<{src:string, out:string, platform:'browser'|'node', target?:string, format?:string, external?:string[], plugins?:any[]}>} config.entries
 * @param {boolean|string} [config.hasUi]  — `true` or Vite config path.
 * @param {string} [config.outDir]     — Output dir (defaults to ../../plugins/<name>/).
 * @param {Array<{name:string, searchPaths:string[], outFile?:string}>} [config.nativeBinaries]
 * @param {string} [config.uiOutDirEnv]  — Env var for Vite out dir (default "PLUGIN_OUT_DIR").
 * @param {boolean} [config.sourcemap]  — Esbuild sourcemaps (default true).
 * @param {boolean} [config.minify]     — Esbuild minification (default false).
 */
export async function buildPlugin(callerMetaUrl, config) {
  const callerDir = dirname(fileURLToPath(callerMetaUrl));
  const srcDir = resolve(callerDir, "..");
  const outDir = config.outDir ?? resolve(srcDir, "..", "..", "plugins", config.pluginName);
  const { pluginName } = config;

  let builtCount = 0;

  for (const entry of config.entries) {
    const entryFile = resolve(srcDir, entry.src);
    if (!existsSync(entryFile)) {
      console.log(`  \u2139  ${pluginName}: source not found \u2014 ${entry.src}`);
      continue;
    }

    const platform = entry.platform;
    const target = entry.target ?? DEFAULT_TARGET[platform] ?? "es2022";
    const format = entry.format ?? DEFAULT_FORMAT[platform] ?? "esm";
    const external = entry.external ?? DEFAULT_EXTERNAL[platform] ?? [];
    const sourcemap = config.sourcemap ?? true;
    const minify = config.minify ?? false;

    console.log(`  \u2502  ${pluginName}: ${entry.src} \u2192 ${entry.out} (${platform})`);

    try {
      await esbuild.build({
        entryPoints: [entryFile],
        outfile: join(outDir, entry.out),
        bundle: true,
        platform,
        target,
        format,
        minify,
        sourcemap,
        treeShaking: true,
        external,
        plugins: entry.plugins,
      });
      builtCount++;
      console.log(`  \u2502  \u2192 ${join(outDir, entry.out)}`);
    } catch (err) {
      console.error(`  \u2716  ${pluginName}: failed to build ${entry.src}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (builtCount > 0) {
    console.log(`  \u2714  ${pluginName}: ${builtCount} entry(s) compiled \u2192 ${outDir}`);
  } else {
    console.log(`  \u2139  ${pluginName}: no entries compiled.`);
  }

  // ── UI build (Vite) ────────────────────────────────────────────────────
  if (config.hasUi) {
    const uiEntry = resolve(srcDir, "ui", "index.html");
    if (existsSync(uiEntry)) {
      const viteConfig = typeof config.hasUi === "string" ? config.hasUi : "vite.ui.config.ts";
      const uiOutDirEnv = config.uiOutDirEnv ?? "PLUGIN_OUT_DIR";
      console.log(`  \u2502  ${pluginName}: building UI (Vite)\u2026`);
      try {
        execSync(`npx vite build --config ${viteConfig}`, {
          cwd: srcDir,
          stdio: "inherit",
          env: { ...process.env, [uiOutDirEnv]: outDir },
        });
        console.log(`  \u2502  \u2192 ${join(outDir, "ui", "index.html")}`);
      } catch (err) {
        console.error(`  \u2716  ${pluginName}: UI build failed: ${err.message}`);
        process.exitCode = 1;
      }
    } else {
      console.log(`  \u2139  ${pluginName}: no ui/index.html \u2014 skipping UI build.`);
    }
  }

  // ── Copy native binaries ────────────────────────────────────────────────
  if (config.nativeBinaries) {
    for (const bin of config.nativeBinaries) {
      let found = false;
      for (const searchPath of bin.searchPaths) {
        const sourcePath = join(searchPath, bin.name);
        if (existsSync(sourcePath)) {
          copyFileSync(sourcePath, join(outDir, bin.outFile ?? bin.name));
          console.log(`  \u2502  ${pluginName}: copied native binary ${bin.name}`);
          found = true;
          break;
        }
      }
      if (!found) {
        console.warn(`  \u26a0  ${pluginName}: native binary ${bin.name} not found in search paths`);
      }
    }
  }

  copyPluginAssets(srcDir, outDir);
}

/**
 * Copy manifest.json and a cleaned package.json from a plugin's source
 * directory to its build output directory.
 */
export function copyPluginAssets(srcDir, outDir) {
  const manifestPath = join(srcDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`  \u2502  copied manifest.json \u2192 ${outDir}`);
  } else {
    console.warn(`  \u26a0  no manifest.json found at ${manifestPath}`);
  }

  const pkgPath = join(srcDir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const { devDependencies, ...cleanPkg } = pkg;
    writeFileSync(join(outDir, "package.json"), JSON.stringify(cleanPkg, null, 2));
    console.log(`  \u2502  copied package.json \u2192 ${outDir}`);
  }
}
