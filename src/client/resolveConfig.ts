import type { AgentClientConfig } from "./types";
import type { AgentHandler } from "@agent-type";
import { createMinIntervalQueue } from "@agent-sdk/utils/minIntervalQueue";

/**
 * `AgentClientConfig` with all optional-with-defaults fields resolved to their
 * concrete types.  Produced by `resolveAgentClientConfig` and used internally
 * throughout `createAgentClient` so that no call-site needs to supply `?? []`
 * or similar fallbacks.
 */
export type ResolvedAgentClientConfig = ReturnType<
  typeof resolveAgentClientConfig
>;

/**
 * Wrap a handler so that consecutive invocations are always separated by at
 * least `throttleMs`.  Concurrent calls are serialised via a sequential queue
 * (see `createMinIntervalQueue`) so every call is guaranteed to execute once
 * — none are dropped — but each dispatch is spaced by the configured interval.
 */
function createThrottledHandler(
  originalHandler: AgentHandler,
  throttleMs: number,
): AgentHandler {
  const schedule = createMinIntervalQueue(throttleMs);
  return (messages, context) =>
    schedule(() => originalHandler(messages, context), context.signal);
}

export function resolveAgentClientConfig(raw: AgentClientConfig) {
  const handlerThrottleMs = raw.handlerThrottleMs ?? 1000;

  return {
    ...raw,
    tools: raw.tools ?? [],
    toolSets: raw.toolSets ?? [],
    maxAgentTurns: raw.maxAgentTurns ?? 0,
    enableAttachments: raw.enableAttachments ?? true,
    renderUI: raw.renderUI ?? (() => () => void 0),
    handlerThrottleMs,
    handler: createThrottledHandler(raw.handler, handlerThrottleMs),
  };
}
