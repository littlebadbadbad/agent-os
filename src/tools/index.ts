// ── Types (re-exported from @agent-type for convenience) ─────────────────────
export type {
  Tool,
  ToolExecutionContext,
  ToolDescriptor,
  ToolCall,
  ToolResult,
  HandlerContext,
  OpenAIToolParam,
  AnthropicToolParam,
  GeminiFunctionDeclaration,
  AgentTextChunk,
  AgentToolCallChunk,
  AgentStreamChunk,
  AgentTurnResponse,
} from '@agent-type';

export type { ToolRegistry } from './registry';

// ── Runtime helpers ───────────────────────────────────────────────────────────
export { isAgentTurnResponse, isAgentStreamChunk } from './types';

export { defineTool, buildTool } from '@agent-type/defineTool';
export type { ToolDef } from '@agent-type/defineTool';
export { defineSkill, resolveSkillTools } from './skill';
export type { Skill, SkillState } from './skill';
// ── Registry (functional, immutable) ─────────────────────────────────────────
export {
  emptyRegistry,
  withTool,
  withoutTool,
  getRegisteredTool,
  listRegisteredTools,
} from './registry';

// ── Descriptor conversion ─────────────────────────────────────────────────────
export {
  toDescriptor,
  toDescriptors,
  resolveToolDescription,
  toOpenAITool,
  toAnthropicTool,
  toGeminiTool,
} from './toDescriptor';

// ── Execution ─────────────────────────────────────────────────────────────────
export { executeToolCall, validateToolCall, executeValidatedToolCall } from './execute';
export type { ValidatedToolCall } from './execute';

// ── Variable store ────────────────────────────────────────────────────────────
export { createVariableToolSet, isVariableHandle, extractHandles } from './variable';
export type {
  VariableToolSetOptions,
  VariableHandle,
  VariableEntry,
  JsonVariable,
  AttachmentVariable,
  Variable,
  JsonValue,
  JsonObject,
  JsonArray,
  JsonPrimitive,
  VariableStore,
  VariableStoreRef,
  SerializedVariable,
} from './variable';
