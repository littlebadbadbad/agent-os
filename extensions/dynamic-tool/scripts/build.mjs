#!/usr/bin/env node
import { copyFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildPlugin } from "../../../scripts/plugin-build-utils.mjs";

buildPlugin(import.meta.url, {
  pluginName: "dynamic-tool",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
    { src: "backend/index.js",  out: "backend.cjs",  platform: "node"   },
  ],
  hasUi: true,
  nativeBinaries: [{
    name: "better_sqlite3.node",
    searchPaths: [
      join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'node_modules', 'better-sqlite3', 'build', 'Release'),
      join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'node_modules', 'better-sqlite3', 'build', 'Release'),
    ],
  }],
});
