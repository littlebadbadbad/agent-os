import type { AgentTurnResponse, AgentStreamChunk } from '@agent-type';

// ── Structured handler response types ────────────────────────────────────────

// All type definitions (AgentTextChunk, AgentThinkingChunk, AgentToolCallChunk,
// AgentToolResultChunk, AgentAttachmentChunk, AgentUsageChunk, AgentStreamChunk,
// TokenUsage, AgentTurnResponse) are now defined in @agent-type/core.ts

// ── Runtime type guards ───────────────────────────────────────────────────────

export function isAgentTurnResponse(v: unknown): v is AgentTurnResponse {
  return typeof v === 'object' && v !== null && 'text' in v && !('delta' in v);
}

export function isAgentStreamChunk(v: unknown): v is AgentStreamChunk {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    (
      (v as AgentStreamChunk).type === 'text' ||
      (v as AgentStreamChunk).type === 'thinking' ||
      (v as AgentStreamChunk).type === 'tool_call' ||
      (v as AgentStreamChunk).type === 'tool_result' ||
      (v as AgentStreamChunk).type === 'attachment' ||
      (v as AgentStreamChunk).type === 'usage'
    )
  );
}
