/**
 * Tool State app — barrel exports.
 */

export { createToolStateToolSet, TOOL_STATE_SYMBOL } from './toolSet';
export type { ToolStateToolSet } from './toolSet';
export { MANAGE_TOOLS_NAME, createManageToolsTool } from './manageTools';
export type { ManageToolsApi, ManageToolsBatchResult } from './manageTools';
export { RESIDENT_TOOLS, isResident, resolveDescription } from './toolMeta';
export { TOOL_STATE_GUIDANCE, truncateDescription, DESCRIPTION_LIMIT } from './prompt';
export { globalToolStore, createGlobalToolStore } from './globalStore';
export type { GlobalToolStore } from './globalStore';
export { createToolStateBridge } from './bridge';
export type { ToolStateBridge } from './bridge';
export { createToolStateSlots } from './slots';
export type { ToolStateEntry, ToolStateSymbolState } from './types';
