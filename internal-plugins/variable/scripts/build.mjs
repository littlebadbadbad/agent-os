#!/usr/bin/env node
import { buildPlugin } from "../../../scripts/plugin-build-utils.mjs";
buildPlugin(import.meta.url, {
  pluginName: "variable",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
  ],
});
