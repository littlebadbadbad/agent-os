#!/usr/bin/env node
import { buildPlugin } from "../../../scripts/plugin-build-utils.mjs";
buildPlugin(import.meta.url, {
  pluginName: "memory-graph",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
  ],
});
