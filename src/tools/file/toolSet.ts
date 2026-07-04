import type { ToolSet } from '@agent-type';
import type { FileAdapter } from './types';
import { createFileTools } from './tools';

/**
 * Create the file-management ToolSet.
 *
 * Wraps `createFileTools` in a ToolSet so core-tool visibility can be
 * declared here rather than in a static global baseline.
 *
 * Core tools (always visible):
 *   `read_file`, `write_file`, `str_replace`, `list_dir`, `search_files`
 *
 * Deferred tools (discoverable via `tool_search`):
 *   `get_workspace_root`, `set_workspace_root`, `replace_all`,
 *   `delete_file`, `move_file`
 */
export function createFileToolSet(adapter: FileAdapter): ToolSet {
  return {
    name: 'file',
    description: 'File read/write, search, and workspace management',
    tools: createFileTools(adapter),
    coreTools: ['read_file', 'write_file', 'str_replace', 'list_dir', 'search_files'],
  };
}
