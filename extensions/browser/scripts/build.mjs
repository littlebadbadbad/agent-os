#!/usr/bin/env node
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildPlugin, createExternalizePlugin } from "../../../scripts/plugin-build-utils.mjs";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

buildPlugin(import.meta.url, {
  pluginName: "browser",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
    {
      src: "backend/index.js", out: "backend.cjs", platform: "node",
      external: ['@agent-type', '@agent-sdk', 'playwright', 'playwright-core'],
      plugins: [createExternalizePlugin(SRC_DIR)],
    },
  ],
  hasUi: true,
});
