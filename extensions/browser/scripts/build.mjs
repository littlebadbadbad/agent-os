#!/usr/bin/env node
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildPlugin } from "../../../scripts/plugin-build-utils.mjs";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Custom esbuild plugin: externalize all imports outside SRC_DIR.
// playwright/playwright-core must remain unbundled because they probe
// filesystem paths at runtime (browser binary discovery).
const externalizePlugin = {
  name: 'externalize-outside-source',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return undefined;
      const resolved = resolve(dirname(args.importer), args.path);
      if (resolved.startsWith(SRC_DIR)) return undefined;
      if (args.path.startsWith('node:') || args.path === 'module' || args.path === 'path') {
        return { external: true };
      }
      return { external: true };
    });
  },
};

buildPlugin(import.meta.url, {
  pluginName: "browser",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
    {
      src: "backend/index.js", out: "backend.cjs", platform: "node",
      external: ['@agent-type', '@agent-sdk', 'playwright', 'playwright-core'],
      plugins: [externalizePlugin],
    },
  ],
  hasUi: true,
});
