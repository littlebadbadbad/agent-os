import { useSyncExternalStore, useCallback, useMemo } from "react";
import type { ReactElement } from "react";
import type { Attachment, AgentSession } from "@agent-sdk";
import type { SlotEntry } from "../../../slots/registry";
import type { PanelSlotDeclaration } from "@agent-type";
import { ChatMessages } from "../chat/ChatMessages";
import { SubAgentsPanel } from "../panels/SubAgentsPanel";
import { PaneSlotLayout } from "../panes/PaneSlotLayout";
import { buildSlotDisplayContextFromState } from "../../../slots/context";
import styles from "../AgentWidget.module.scss";
import { useSlotRegistry } from "../../../plugin/PluginContext";

// ── Session panel content — nested inside ConversationNavigator's panel view.
//
// Owns the tab bar (Chat / Sub-Agents / Plugin) and renders ChatMessages.
// The ChatInput and list↔panel navigation live in ConversationNavigator.
// Keyed by session ID so React resets local view state when switching sessions.

export function SessionContent({
  session,
  sessionId,
}: {
  session: AgentSession;
  sessionId: string;
}): ReactElement {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  const {
    id: sessionStateId,
    messages,
    subAgentRegistry,
    agentName,
    conversationId,
  } = state;

  const handleEditMessage = useCallback(
    async (
      messageId: string,
      newText: string,
      attachments?: readonly Attachment[],
    ) => {
      await session.editAndSendMessage(messageId, newText, attachments);
    },
    [session],
  );

  const handleClear = useCallback((): void => {
    session.clearHistory();
  }, [session]);

  const { getByType } = useSlotRegistry();

  const slotCtx = useMemo(
    () => buildSlotDisplayContextFromState({ id: sessionStateId, agentName, conversationId }),
    [sessionStateId, agentName, conversationId],
  );

  // ── Slot lists (recomputed on every state change) ──────────────────────

  const headerBarSlots = useMemo(
    () => getByType("headerBar"),
    // getByType result depends on session state — derive via slotCtx
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotCtx, getByType],
  );

  const panelSlots = useMemo<readonly SlotEntry<PanelSlotDeclaration>[]>(
    () =>
      getByType("panel").filter((s) => s.declaration.showTab(slotCtx)) as readonly SlotEntry<PanelSlotDeclaration>[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotCtx, getByType],
  );

  const inlinePromptSlots = useMemo(
    () =>
      getByType("inlinePrompt").filter(
        (s) => s.declaration.shouldRender?.(slotCtx) !== false,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotCtx, getByType],
  );

  const hasSubAgents = subAgentRegistry !== null;
  const hasMessages = messages.length > 0;

  return (
    <PaneSlotLayout
      slotSession={session}
      headerBarSlots={headerBarSlots}
      panelSlots={panelSlots}
      inlinePromptSlots={inlinePromptSlots}
      slotCtx={slotCtx}
      subAgentPanel={
        hasSubAgents ? (
          <SubAgentsPanel registry={subAgentRegistry!} sessionId={sessionStateId} />
        ) : undefined
      }
      tabBarExtra={
        hasMessages ? (
          <button
            type="button"
            className={styles["clear-btn"]}
            onClick={handleClear}
            title="Clear chat history"
          >
            Clear
          </button>
        ) : undefined
      }
    >
      <ChatMessages
        messages={messages}
        onEditMessage={handleEditMessage}
        session={session}
      />
    </PaneSlotLayout>
  );
}
