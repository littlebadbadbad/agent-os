#!/usr/bin/env node
import { buildApp } from "../../../scripts/app-build-utils.mjs";
buildApp(import.meta.url, {
  appName: "experience",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
  ],
  hasUi: true,
});
