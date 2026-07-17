// ── Tool family identification ────────────────────────────────────────────────
//
// Pure predicates — no React, no imports.  Import from anywhere without cost.

const FILE_TOOL_NAMES = new Set([
  'read_file', 'write_file', 'str_replace', 'delete_file',
  'move_file', 'list_dir', 'search_files',
  'get_workspace_root', 'set_workspace_root',
]);

const DYNAMIC_TOOL_NAMES = new Set([
  'create_tool', 'update_tool', 'delete_tool', 'list_dynamic_tools',
]);


export function isFileTool(name: string): boolean {
  return FILE_TOOL_NAMES.has(name);
}

export function isAskUserTool(name: string): boolean {
  return name === 'ask_user';
}

export function isDynamicTool(name: string): boolean {
  return DYNAMIC_TOOL_NAMES.has(name);
}


export function isSubAgentMetaTool(name: string): boolean {
  return name.endsWith('_subagent') || name.endsWith('_subagents');
}
