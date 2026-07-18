/**
 * extensions/file/agent/toolSet.ts — File ToolSet factory
 */

import type { ToolSet, ToolSetContext, PluginSlotDeclaration, CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';
import type { FileAdapter } from './types';
import { createFileTools } from './tools';

export const FILE_SYMBOL = Symbol('file');

function fileDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const summary = info.status === 'running' ? `${info.name}\u2026` : info.name;
  return { icon: '\uD83D\uDCC4', label: 'File', summary, status: info.status };
}

export function createFileToolSet(adapter: FileAdapter): ToolSet {
  const tools = createFileTools(adapter);

  return {
    name: 'file',
    symbol: FILE_SYMBOL,
    description: 'File read/write, search, and workspace management',
    tools,
    coreTools: ['read_file', 'write_file', 'str_replace', 'list_dir', 'search_files'],

    onGetSymbolState: (_ctx: ToolSetContext) => ({
      type: 'file' as const,
      slots: [
        { type: 'toolCard' as const, toolNames: tools.map((t) => t.name) },
        { type: 'compactToolCard' as const, toolNames: tools.map((t) => t.name), getDescriptor: fileDescriptor },
      ] satisfies readonly PluginSlotDeclaration[],
    }),
  };
}
