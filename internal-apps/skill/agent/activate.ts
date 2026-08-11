/**
 * internal-apps/skill/agent/activate.ts — Skill app activation entry
 *
 * This is the app's agent-side entry point, loaded by the app runtime
 * when the skill extension is activated.
 *
 * The app receives an AgentAppHost with a pre-bound apiClient
 * (no appId parameter needed) and registers its ToolSet.
 */

import type { AgentAppHost } from '@agent-type';
import type { SkillBridge } from './types';
import { createSkillAppAdapter } from './appAdapter';
import { createSkillToolset } from './manager';

/**
 * Activate the skill app.
 *
 * Creates a app adapter backed by the pre-bound apiClient, builds
 * the skill ToolSet, registers it, and populates the bridge so the UI
 * can call ToolSet operations directly.
 *
 * @param host  The AgentAppHost for this app.
 */
export function activate(host: AgentAppHost<SkillBridge>): void {
  const adapter = createSkillAppAdapter(host.apiClient);

  const { toolSet, slotDeclarations, bridgeMethods } = createSkillToolset(adapter);

  host.registerToolSet(toolSet, slotDeclarations);
  Object.assign(host.bridge, bridgeMethods);
}
