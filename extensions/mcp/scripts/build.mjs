#!/usr/bin/env node
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildPlugin } from "../../../scripts/plugin-build-utils.mjs";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  pluginName: "mcp",
  entries: [
    { src: "agent/activate.ts", out: "activate.js", platform: "browser" },
    {
      src: "backend/index.js", out: "backend.cjs", platform: "node",
      plugins: [externalizePlugin],
    },
  ],
  hasUi: true,
});
