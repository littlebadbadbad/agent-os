import { toDescriptors } from '@agent-sdk/tools/toDescriptor';
import type { ToolManager } from '@agent-sdk/client/toolManager';
import type { HandlerContext, ToolChoice } from '@agent-type';
import { MAIN_CONVERSATION_ID } from '@agent-sdk/tools/toolSet';
import type { ToolSet, ToolSetContext } from '@agent-type';
import type { ToolCallPipeline } from '@agent-sdk/tools/callToolPipeline';
import { buildSystemPrompt, applyToolFilters } from '@agent-sdk/tools/agentRuntime';
import type { SystemPromptCache } from '@agent-sdk/tools/prompts/section';

/**
 * Build a `HandlerContext` from a session slot and per-turn parameters.
 *
 * Snapshots the full registered-tool list at call time, then applies every
 * ToolSet's `onFilterTools` hook in order so that, e.g., `ToolStateToolSet`
 * can remove disabled tools before the descriptors are sent to the model.
 *
 * Each registered ToolSet's `onGetSystemPrompt` hook is called with a
 * `SystemPromptContext` that includes the user message, the agent's base system
 * prompt, and the accumulated prompt from all ToolSets that ran before it.
 * `userMessage` is `undefined` for headless/programmatic calls.
 *
 * When `sectionCache` is provided, `buildSystemPrompt` uses it to avoid
 * recomputing unchanged system-prompt sections on every LLM turn.
 */
export function buildHandlerContext(
  toolManager: ToolManager,
  systemPrompt: string | undefined,
  toolChoice: ToolChoice | undefined,
  sessionId: string,
  agentName: string,
  signal: AbortSignal,
  userMessage: string | undefined,
  toolSets: readonly ToolSet[],
  callToolFn: ToolCallPipeline,
  sectionCache?: SystemPromptCache,
): HandlerContext {
  const ctx: ToolSetContext = { sessionId, agentName, conversationId: MAIN_CONVERSATION_ID };

  const tools = applyToolFilters(toolManager.getTools(), toolSets, ctx);
  const resolvedSystemPrompt = buildSystemPrompt(systemPrompt, toolSets, ctx, userMessage, sectionCache);

  return {
    tools: toDescriptors(tools),
    callTool: (call) => callToolFn(call, signal),
    toolChoice: toolChoice ?? 'auto',
    systemPrompt: resolvedSystemPrompt,
    signal,
  };
}
