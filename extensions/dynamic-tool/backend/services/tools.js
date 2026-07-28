/**
 * extensions/dynamic-tool/backend/services/tools.js — Dynamic-tool business API
 */

export function createToolServices(stores) {
  const { toolStore, moduleStore, depStore, proxyRequest } = stores;

  function getToolsList() {
    const tools = toolStore.listTools().map((entry) => {
      const { name, description, parameters, runtime, createdAt, implementation } = entry;
      return { name, description, parameters, runtime, createdAt, ...(runtime === 'frontend' && { implementation }) };
    });
    return { tools };
  }

  function createTool({ name, description, parameters, implementation, runtime }) {
    if (!name || typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error('name must be a non-empty lowercase snake_case string');
    }
    if (!description || typeof description !== 'string') throw new Error('description is required');
    if (!implementation || typeof implementation !== 'string') throw new Error('implementation is required');
    const rt = runtime ?? 'backend';
    if (rt !== 'backend' && rt !== 'frontend') throw new Error('runtime must be "backend" or "frontend"');
    const resolvedParameters = parameters ?? { type: 'object', properties: {} };
    toolStore.upsertTool({ name, description, parameters: resolvedParameters, implementation, runtime: rt });
    return {
      created: name,
      tool: { name, description, parameters: resolvedParameters, runtime: rt, ...(rt === 'frontend' && { implementation }) },
    };
  }

  function updateTool({ name, patch }) {
    const existing = toolStore.getTool(name);
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
    toolStore.upsertTool(merged);
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

  function deleteTool({ name }) {
    if (!toolStore.removeTool(name)) throw new Error(`Tool "${name}" not found`);
    return { deleted: name };
  }

  async function runTool({ name, args, ctx }) {
    if (!name) throw new Error('name is required');
    const tool = toolStore.getTool(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    if (tool.runtime === 'frontend') throw new Error(`Tool "${name}" is a frontend tool`);
    const base = ctx ?? {};
    const enrichedCtx = proxyRequest ? { ...base, proxyRequest } : base;
    const result = await toolStore.executeTool(name, args, enrichedCtx);
    return { result };
  }

  function getModulesList() {
    return { modules: moduleStore.listModules() };
  }

  function getToolModule({ name }) {
    if (!name) throw new Error('name is required');
    const mod = moduleStore.getModule(name);
    if (!mod) throw new Error(`Module "${name}" not found`);
    return mod;
  }

  function createToolModule({ name, description, content, language }) {
    if (!name) throw new Error('name is required');
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('name must be a non-empty kebab-case string');
    if (!description || typeof description !== 'string') throw new Error('description is required');
    if (!content || typeof content !== 'string') throw new Error('content is required');
    if (!/export\s/.test(content)) throw new Error('content must contain at least one export');
    moduleStore.upsertModule({ name, description, content, language });
    return { created: name };
  }

  function updateToolModule({ name, patch }) {
    if (!name) throw new Error('name is required');
    const existing = moduleStore.getModule(name);
    if (!existing) throw new Error(`Module "${name}" not found`);
    if (!patch || Object.keys(patch).length === 0) throw new Error('At least one field to update is required');
    if (patch.content !== undefined && !/export\s/.test(patch.content)) {
      throw new Error('content must contain at least one export');
    }
    moduleStore.upsertModule({ name, ...patch });
    return { updated: name };
  }

  function deleteToolModule({ name }) {
    if (!name) throw new Error('name is required');
    if (!moduleStore.getModule(name)) throw new Error(`Module "${name}" not found`);
    moduleStore.removeModule(name);
    return { deleted: name };
  }

  function getDepsList() {
    return depStore.listDeps();
  }

  async function installToolDeps({ packages }) {
    if (!Array.isArray(packages) || packages.length === 0) throw new Error('packages array is required');
    return depStore.installDeps(packages);
  }

  async function removeToolDep({ pkg }) {
    if (!pkg) throw new Error('pkg is required');
    return depStore.removeDep(pkg);
  }

  return {
    getToolsList, createTool, updateTool, deleteTool, runTool,
    getModulesList, getToolModule, createToolModule, updateToolModule, deleteToolModule,
    getDepsList, installToolDeps, removeToolDep,
  };
}
