/**
 * backend/lib/services/tools.js — Dynamic-tool business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here: validation, formatting, response shaping.
 */

import {
  listTools,
  getTool,
  upsertTool,
  removeTool,
  executeTool,
} from '../lib/store.js';
import {
  listModules,
  getModule,
  upsertModule,
  removeModule,
} from '../lib/moduleStore.js';
import {
  listDeps,
  installDeps,
  removeDep,
} from '../lib/depStore.js';

// ── Tools ─────────────────────────────────────────────────────────────────────

export function getToolsList() {
  const tools = listTools().map((entry) => {
    const { name, description, parameters, runtime, createdAt, implementation } = entry;
    return {
      name, description, parameters, runtime, createdAt,
      ...(runtime === 'frontend' && { implementation }),
    };
  });
  return { tools };
}

export function createTool({ name, description, parameters, implementation, runtime }) {
  if (!name || typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error('name must be a non-empty lowercase snake_case string');
  }
  if (!description || typeof description !== 'string') throw new Error('description is required');
  if (!implementation || typeof implementation !== 'string') throw new Error('implementation is required');
  const rt = runtime ?? 'backend';
  if (rt !== 'backend' && rt !== 'frontend') throw new Error('runtime must be "backend" or "frontend"');
  const resolvedParameters = parameters ?? { type: 'object', properties: {} };
  upsertTool({ name, description, parameters: resolvedParameters, implementation, runtime: rt });
  return {
    created: name,
    tool: { name, description, parameters: resolvedParameters, runtime: rt, ...(rt === 'frontend' && { implementation }) },
  };
}

export function updateTool({ name, patch }) {
  const existing = getTool(name);
  if (!existing) throw new Error(`Tool "${name}" not found`);
  if (!patch || Object.keys(patch).length === 0) throw new Error('At least one field to update is required');
  const { description, parameters, implementation, runtime } = patch;
  if (runtime !== undefined && runtime !== 'backend' && runtime !== 'frontend') {
    throw new Error('runtime must be "backend" or "frontend"');
  }
  const merged = {
    name,
    description: description ?? existing.description,
    parameters: parameters ?? existing.parameters,
    implementation: implementation ?? existing.implementation,
    runtime: runtime ?? existing.runtime,
  };
  upsertTool(merged);
  return {
    updated: name,
    tool: {
      name,
      description: merged.description,
      parameters: merged.parameters,
      runtime: merged.runtime,
      ...(merged.runtime === 'frontend' && { implementation: merged.implementation }),
    },
  };
}

export function deleteTool({ name }) {
  if (!removeTool(name)) throw new Error(`Tool "${name}" not found`);
  return { deleted: name };
}

export async function runTool({ name, args, ctx }) {
  if (!name) throw new Error('name is required');
  const tool = getTool(name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  if (tool.runtime === 'frontend') throw new Error(`Tool "${name}" is a frontend tool`);
  const result = await executeTool(name, args, ctx ?? {});
  return { result };
}

// ── Modules ───────────────────────────────────────────────────────────────────

export function getModulesList() {
  return { modules: listModules() };
}

export function getToolModule({ name }) {
  if (!name) throw new Error('name is required');
  const mod = getModule(name);
  if (!mod) throw new Error(`Module "${name}" not found`);
  return mod;
}

export function createToolModule({ name, description, content, language }) {
  if (!name) throw new Error('name is required');
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('name must be a non-empty kebab-case string');
  if (!description || typeof description !== 'string') throw new Error('description is required');
  if (!content || typeof content !== 'string') throw new Error('content is required');
  if (!/export\s/.test(content)) throw new Error('content must contain at least one export');
  upsertModule({ name, description, content, language });
  return { created: name };
}

export function updateToolModule({ name, patch }) {
  if (!name) throw new Error('name is required');
  const existing = getModule(name);
  if (!existing) throw new Error(`Module "${name}" not found`);
  if (!patch || Object.keys(patch).length === 0) throw new Error('At least one field to update is required');
  if (patch.content !== undefined && !/export\s/.test(patch.content)) {
    throw new Error('content must contain at least one export');
  }
  upsertModule({ name, ...patch });
  return { updated: name };
}

export function deleteToolModule({ name }) {
  if (!name) throw new Error('name is required');
  const existing = getModule(name);
  if (!existing) throw new Error(`Module "${name}" not found`);
  removeModule(name);
  return { deleted: name };
}

// ── Deps ──────────────────────────────────────────────────────────────────────

export function getDepsList() {
  return listDeps();
}

export async function installToolDeps({ packages }) {
  if (!Array.isArray(packages) || packages.length === 0) throw new Error('packages array is required');
  return installDeps(packages);
}

export async function removeToolDep({ pkg }) {
  if (!pkg) throw new Error('pkg is required');
  return removeDep(pkg);
}
