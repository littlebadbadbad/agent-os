#!/usr/bin/env node
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildPlugin, createExternalizePlugin } from "../../../scripts/plugin-build-utils.mjs";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

buildPlugin(import.meta.url, {
  pluginName: "cron",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
    {
      src: "backend/index.js", out: "backend.cjs", platform: "node",
      plugins: [createExternalizePlugin(SRC_DIR)],
    },
  ],
  hasUi: true,
  // Cron uses PLUGIN_UI_OUT_DIR instead of the default PLUGIN_OUT_DIR.
  uiOutDirEnv: "PLUGIN_UI_OUT_DIR",
});
