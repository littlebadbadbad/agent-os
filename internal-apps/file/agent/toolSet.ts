/**
 * internal-apps/file/agent/toolSet.ts — File ToolSet factory
 */

import type { ToolSet, ToolSetContext, SlotDeclaration, CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';
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

    onGetSymbolState: (_ctx: ToolSetContext) => ({
      type: 'file' as const,
    }),
  };
}

export function getFileSlotDeclarations(
  toolNames: readonly string[],
): readonly SlotDeclaration[] {
  return [
    {
      type: 'app' as const,
      icon: '\uD83D\uDCC1',
      label: '文件',
      shouldRender: () => true,
      defaultWidth: 1100,
      defaultHeight: 720,
      resizable: true,
      minimizable: true,
    },
    { type: 'toolCard' as const, toolNames },
    { type: 'compactToolCard' as const, toolNames, getDescriptor: fileDescriptor },
  ] satisfies readonly SlotDeclaration[];
}
