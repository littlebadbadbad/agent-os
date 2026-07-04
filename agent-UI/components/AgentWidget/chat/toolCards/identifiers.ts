// ── Tool family identification ────────────────────────────────────────────────
//
// Pure predicates — no React, no imports.  Import from anywhere without cost.

const FILE_TOOL_NAMES = new Set([
  'read_file', 'write_file', 'str_replace', 'delete_file',
  'move_file', 'list_dir', 'search_files',
  'get_workspace_root', 'set_workspace_root',
]);

const TODO_TOOL_NAMES = new Set(['todo_write', 'todo_read']);

const DYNAMIC_TOOL_NAMES = new Set([
  'create_tool', 'update_tool', 'delete_tool', 'list_dynamic_tools',
]);

const MCP_TOOL_NAMES = new Set([
  'list_mcp_servers', 'add_mcp_server', 'remove_mcp_server',
  'connect_mcp_server', 'disable_mcp_server',
]);

const SKILL_TOOL_NAMES = new Set([
  'install_skill', 'list_skills', 'remove_skill', 'read_skill_file',
]);

export function isFileTool(name: string): boolean {
  return FILE_TOOL_NAMES.has(name);
}

export function isTerminalTool(name: string): boolean {
  return name.startsWith('terminal_');
}

export function isTodoTool(name: string): boolean {
  return TODO_TOOL_NAMES.has(name);
}

export function isAskUserTool(name: string): boolean {
  return name === 'ask_user';
}

export function isDynamicTool(name: string): boolean {
  return DYNAMIC_TOOL_NAMES.has(name);
}

export function isMcpTool(name: string): boolean {
  return MCP_TOOL_NAMES.has(name);
}

export function isSkillTool(name: string): boolean {
  return SKILL_TOOL_NAMES.has(name);
}

export function isSubAgentMetaTool(name: string): boolean {
  return name.endsWith('_subagent') || name.endsWith('_subagents');
}

const EXPERIENCE_TOOL_NAMES = new Set([
  'experience_add', 'experience_update', 'experience_delete', 'experience_list',
]);

export function isExperienceTool(name: string): boolean {
  return EXPERIENCE_TOOL_NAMES.has(name);
}
