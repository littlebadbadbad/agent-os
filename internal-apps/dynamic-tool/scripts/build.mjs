#!/usr/bin/env node
import { copyFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildApp } from "../../../scripts/app-build-utils.mjs";

buildApp(import.meta.url, {
  appName: "dynamic-tool",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
    { src: "backend/index.js",  out: "backend.cjs",  platform: "node"   },
  ],
  hasUi: true,
  nativeBinaries: [{
    name: "better_sqlite3.node",
    searchPaths: [
      // Project root's node_modules (when run via compile-apps.mjs or standalone)
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'node_modules', 'better-sqlite3', 'build', 'Release'),
      // Local node_modules (pnpm hoisted workspace)
      join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'node_modules', 'better-sqlite3', 'build', 'Release'),
    ],
  }],
});
