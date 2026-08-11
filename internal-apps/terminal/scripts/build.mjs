#!/usr/bin/env node
import { buildApp } from "../../../scripts/app-build-utils.mjs";
buildApp(import.meta.url, {
  appName: "terminal",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
    {
      src: "backend/index.js", out: "backend.cjs", platform: "node",
      external: ["@agent-type", "@agent-sdk", "node-pty"],
    },
  ],
  hasUi: true,
});
