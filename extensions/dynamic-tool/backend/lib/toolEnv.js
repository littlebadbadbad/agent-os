/**
 * extensions/dynamic-tool/backend/lib/toolEnv.js — Tool execution environment
 */

import { mkdirSync, existsSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

export function createToolEnv(dataDir) {
  const TOOL_SCRIPTS_DIR = join(dataDir, 'tool-scripts');
  const TOOL_MODULES_DIR = join(TOOL_SCRIPTS_DIR, 'modules');
  const TOOL_EXEC_DIR = join(TOOL_SCRIPTS_DIR, '_exec');

  function ensureToolEnv() {
    mkdirSync(TOOL_MODULES_DIR, { recursive: true });
    mkdirSync(TOOL_EXEC_DIR, { recursive: true });

    const pkgFile = join(TOOL_SCRIPTS_DIR, 'package.json');
    if (!existsSync(pkgFile)) {
      writeFileSync(pkgFile, JSON.stringify({
        name: 'tool-scripts',
        version: '1.0.0',
        private: true,
        type: 'module',
        imports: { '#modules/*': './modules/*.mjs' },
      }, null, 2) + '\n', 'utf8');
    }

    let purged = 0;
    for (const f of readdirSync(TOOL_EXEC_DIR)) {
      try { unlinkSync(join(TOOL_EXEC_DIR, f)); purged++; } catch { /* ok */ }
    }
    if (purged > 0) {
      console.log(`[toolEnv] purged ${purged} stale file(s) from _exec/`);
    }
  }

  return { TOOL_SCRIPTS_DIR, TOOL_MODULES_DIR, TOOL_EXEC_DIR, ensureToolEnv };
}
