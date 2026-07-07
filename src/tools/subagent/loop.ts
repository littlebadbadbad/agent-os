import { emptyRegistry, withTool } from '../registry';
import { executeToolCall } from '../execute';
import { toDescriptors } from '../toDescriptor';
import { runAgentLoopCore } from '../agentLoopCore';
import type { Tool, ToolCall, ToolResult, ToolChoice, HandlerContext, AgentMessage } from '@agent-type';
import type { SubAgentConfig, SubAgentResult } from './types';

// ── Context builder ────────────────────────────────────────────────────────────

type ContextOptions = {
  tools: readonly Tool[];
  toolChoice: ToolChoice;
  systemPrompt: string | undefined;
  signal: AbortSignal;
  agentName: string;
  conversationId: string;
  /**
   * Parent session ID for registry keying.
   * Passed as `sessionId` in every tool execution context so that tools
   * (e.g. `create_*_subagent`) resolve against the root session's registry
   * rather than creating isolated per-conversation registries.
   */
  sessionId: string;
};

function buildContext(
  options: ContextOptions,
  callTool: (call: ToolCall) => Promise<ToolResult>,
): HandlerContext {
  const { tools, toolChoice, systemPrompt, signal } = options;
  return { tools: toDescriptors(tools as Tool[]), callTool, toolChoice, systemPrompt, signal };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Execute a complete, isolated agentic loop for a sub-task.
 *
 * The sub-agent has its own conversation history and tool registry.
 * It shares nothing with the parent agent unless you pass the same `Tool`
 * instances in `config.tools`.
 *
 * Parallel tool execution, error isolation, signal propagation, and a turn
 * cap are all handled automatically by `runAgentLoopCore`.
 */
export async function runAgentLoop(config: SubAgentConfig): Promise<SubAgentResult> {
  const {
    message,
    handler,
    tools = [],
    maxTurns = 10,
    toolChoice = 'auto',
    systemPrompt,
    signal,
    onTextDelta,
    onBeforeInvoke,
    onAfterTurn,
    initialHistory,
    attachments,
    agentName,
    conversationId,
    sessionId,
  } = config;

  // Standalone fallback — used only when no pipeline is injected (e.g. unit tests).
  // In production, `config.callTool` is always the ToolSet pipeline from registry.ts,
  // which already calls `onPatchToolContext` with this sub-agent's ToolSetContext.
  const fallbackRegistry = tools.reduce((reg, t) => withTool(reg, t), emptyRegistry());
  const fallbackCallTool = (call: ToolCall) =>
    executeToolCall(fallbackRegistry, call, {
      signal,
      sessionId,
      agentName,
      conversationId,
      sourceAgent: agentName as 'main' | string,
      isSubAgent: true,
    });

  // Resolve the final callTool BEFORE building HandlerContext so that
  // context.callTool and the loop's callTool are always the same function.
  // This ensures handlers that call context.callTool(...) directly also go
  // through ToolSet hooks (onPatchToolContext, etc.) — same as the main agent.
  const callTool = config.callTool ?? fallbackCallTool;
  const context = buildContext(
    { tools, toolChoice, systemPrompt, signal, agentName, conversationId, sessionId },
    callTool,
  );

  const firstUserMessage: AgentMessage = attachments?.length
    ? { role: 'user', content: message, attachments }
    : { role: 'user', content: message };

  const result = await runAgentLoopCore({
    initialHistory: [...(initialHistory ?? []), firstUserMessage],
    maxTurns,
    signal,
    invokeHandler: (msgs, sig) =>
      handler([...msgs] as AgentMessage[], { ...context, signal: sig }),
    callTool,
    hooks: {
      onBeforeInvoke: () => onBeforeInvoke?.() ?? [],
      onAssistantText: (text) => { if (text) onTextDelta?.(text); },
      onTextDelta: (delta) => onTextDelta?.(delta),
      onAfterTurn: async (history, usage, sig) => {
        return onAfterTurn?.(history, usage, sig);
      },
    },
  });

  return {
    output: result.output,
    turns: result.turns,
    toolCallCount: result.toolCallCount,
    history: result.history,
  };
}

