/**
 * agent-UI/slots/context.ts — SlotDisplayContext builders
 *
 * Small helper functions for constructing {@link SlotDisplayContext}
 * from session-like objects.  Extracted from the identical inline
 * constructions in:
 *   - `SessionContent.tsx`
 *   - `SubAgentsPanel.tsx` / `ConversationPane`
 */

import type { SlotDisplayContext, SlotSession } from '@agent-type';

/**
 * Build a `SlotDisplayContext` from a `SlotSession`.
 *
 * Plugins use this context to decide whether a slot should render
 * for the current conversation (main agent vs. sub-agent).
 */
export function buildSlotDisplayContext(session: SlotSession): SlotDisplayContext {
  const state = session.getState();
  return {
    sessionId: state.id,
    agentName: state.agentName,
    conversationId: state.conversationId,
  };
}

/**
 * Build a `SlotDisplayContext` from explicit state fields.
 *
 * Use this variant when the session state is already destructured
 * (e.g. from `useSyncExternalStore`).
 */
export function buildSlotDisplayContextFromState(state: {
  readonly id: string;
  readonly agentName: string;
  readonly conversationId: string;
}): SlotDisplayContext {
  return {
    sessionId: state.id,
    agentName: state.agentName,
    conversationId: state.conversationId,
  };
}
