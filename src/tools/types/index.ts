// ── UserInput types (owned by the userInput ToolSet) ─────────────────────────
// Re-exported here for convenience; defined in the toolset alongside the
// module augmentation that extends ToolExecutionContext.
export type { UserInputRequest, UserInputAdapter } from '../userInput/types';

// ── Runtime value re-exports (keep at original paths per R5) ──────────────────
export { resolveToolField, resolveFactory } from './core';
export { isAgentTurnResponse, isAgentStreamChunk } from './response';

// All type re-exports (Tool, ToolDescriptor, ToolCall, ToolResult, etc.) are
// now accessed from @agent-type instead.
