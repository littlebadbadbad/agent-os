import type { Tool, ToolCall, ToolResult, ToolChoice, TokenUsage, AgentHandler, AgentMessage } from '@agent-type';
import type { Attachment } from '@agent-type';

/** Outcome returned by `runAgentLoop`. */
export type SubAgentResult = {
  /** Final assistant text produced by the sub-agent. */
  output: string;
  /** Number of handler invocations performed. */
  turns: number;
  /** Total number of tool calls executed across all turns. */
  toolCallCount: number;
  /**
   * Full conversation history after execution.
   * Includes the initial user message plus all assistant / tool turns.
   * Pass this back as `initialHistory` on the next call to continue the conversation.
   */
  history: AgentMessage[];
};

export type SubAgentConfig = {
  /** The message to send to the sub-agent (becomes the next user turn). */
  message: string;
  /** LLM handler. Can be the same as the parent or a specialised one. */
  handler: AgentHandler;
  /** Tools available to the sub-agent. Defaults to `[]` (text-only reasoning). */
  tools?: readonly Tool[];
  /** Maximum agentic turns. Defaults to `10`. */
  maxTurns?: number;
  /** Tool-choice mode. Defaults to `'auto'`. */
  toolChoice?: ToolChoice;
  /**
   * Optional system prompt for the sub-agent.
   * When provided it is prepended to the context passed to the handler,
   * giving the sub-agent a dedicated role / persona separate from the parent.
   */
  systemPrompt?: string;
  /** Abort signal forwarded from the parent so the sub-agent gets cancelled. */
  signal: AbortSignal;
  /**
   * Called for each text chunk during streaming, or once with the full text
   * for non-streaming handler responses. Use this to observe live text output.
   */
  onTextDelta?: (delta: string) => void;
  /**
   * Prior conversation history to prepend before the task message.
   * Enables stateful multi-turn sub-agent conversations when combined with
   * `SubAgentResult.history` returned from the previous call.
   */
  initialHistory?: readonly AgentMessage[];
  /**
   * Called after every completed turn (assistant response + any tool calls).
   * Receives the full history at that point and the usage from the turn (if available).
   * If it returns a new `AgentMessage[]`, that array replaces the current history
   * — enabling compaction / summarization between turns.
   * The hook is awaited before the next turn begins; if it throws the loop aborts.
   */
  /**
   * Called before each handler invocation (LLM call). Return pending user
   * messages to inject into the conversation history for this turn.
   */
  onBeforeInvoke?: () => AgentMessage[];
  onAfterTurn?: (
    history: AgentMessage[],
    usage: TokenUsage | undefined,
    signal: AbortSignal,
  ) => Promise<AgentMessage[] | void>;
  /**
   * Multimodal attachments to include with the opening user turn.
   * Resolved variable handles (`$var:xxxxxxxx` for `AttachmentVariable`s) are
   * expanded into `Attachment` objects by the caller before this field is set.
   * When present they are embedded directly in the first `UserMessage` so the
   * sub-agent's LLM can see the images / documents on the very first turn.
   */
  attachments?: readonly Attachment[];
  /**
   * Optional tool-call executor override.
   * When provided, `runAgentLoop` uses this instead of the built-in
   * `executeToolCall` path so that ToolSet hooks (variable resolution,
   * result interception) are applied to sub-agent tool calls as well.
   * Signature mirrors `HandlerContext.callTool`.
   */
  callTool?: (call: ToolCall) => Promise<ToolResult>;
  /**
   * Name of the agent executing this loop.
   * Injected into every tool call's `ToolExecutionContext.agentName`.
   */
  agentName: string;
  /**
   * Unique conversation ID for this execution.
   * Injected into every tool call's `ToolExecutionContext.conversationId`.
   */
  conversationId: string;
  /**
   * Parent session ID for registry keying.
   * When sub-agents run tools (including `create_*_subagent`), tool execution
   * contexts use this ID as `sessionId` so that nested sub-agents are registered
   * in the same per-session registry as the root session — making them visible
   * in the UI alongside their siblings.
   */
  sessionId: string;
};

