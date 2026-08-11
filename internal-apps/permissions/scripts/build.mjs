#!/usr/bin/env node
import { buildApp } from "../../../scripts/app-build-utils.mjs";
buildApp(import.meta.url, {
  appName: "permissions",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
  ],
});
