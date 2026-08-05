/**
 * internal-plugins/skill/backend/index.js — Skill plugin backend activation entry
 *
 * Registers all skill API methods via BackendPluginHost.
 * Delegates to the skill service functions.
 *
 * When compiled by compile-plugins.mjs, esbuild bundles all dependencies
 * into a single self-contained plugins/skill/backend/index.js file.
 */

import { createSkillStore } from './lib/skill-store/index.js';
import { createSkillFs } from './lib/skill-store/skill-fs.js';
import { createSkillService } from './services/skills.js';

/** @import { BackendPluginHost } from '../../../../agent-type/plugin.ts' */

/**
 * Activate the skill plugin backend.
 * Registers all API methods.  Each receives params as Record<string, unknown>.
 *
 * @param {BackendPluginHost} host
 */
export function activate(host) {
  // Determine the agent directory for skill storage.
  const agentDir = host.getAgentDir();
  if (!agentDir) throw new Error('getAgentDir() returned null — cannot determine skill storage path');

  // Create the filesystem layer bound to this agent directory.
  const skillFs = createSkillFs(agentDir);

  // Get proxy config from host for proxy-aware skill fetching.
  const proxyConfig = host.getBackendConfig('proxy');

  // Create the skill store (filesystem CRUD) using the fs helpers.
  const store = createSkillStore(agentDir, skillFs, proxyConfig);

  // Create the business-logic layer.
  const svc = createSkillService(store);

  // ── CRUD skills ──────────────────────────────────────────────────────────
  host.defineApi('listSkills', async (_params) => svc.getSkillsList().skills);
  host.defineApi('getSkill', async (params) => svc.getSkillInfo({ name: params?.name }));
  host.defineApi('installSkill', async (params) => svc.installSkill({
    url:     params?.url,
    name:    params?.name,
    content: params?.content,
    useProxy: params?.useProxy,
  }));
  host.defineApi('removeSkill', async (params) => svc.removeSkillByName({ name: params?.name }));
  host.defineApi('readSkillFile', async (params) => svc.readSkillFileContent({
    name: params?.name ?? params?.skill,
    path: params?.path,
  }));
}
