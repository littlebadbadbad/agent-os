#!/usr/bin/env node
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildApp, createExternalizeApp } from "../../../scripts/app-build-utils.mjs";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

buildApp(import.meta.url, {
  appName: "mcp",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
    {
      src: "backend/index.js", out: "backend.cjs", platform: "node",
      plugins: [createExternalizeApp(SRC_DIR)],
    },
  ],
  hasUi: true,
});
