import { useSyncExternalStore, useState, useCallback } from "react";
import type { ReactElement } from "react";
import type { Attachment, AgentSession } from "@agent-sdk";
import { ChatMessages } from "../chat/ChatMessages";
import { ChatInput } from "../chat/ChatInput";
import { SubAgentsPanel } from "../panels/SubAgentsPanel";
import { ExperiencePanel } from "../panels/ExperiencePanel";
import { PluginTabBar } from "../plugin/PluginTabBar";
import { SlotRenderer } from "../../../slots/SlotRenderer";
import { buildSlotDisplayContextFromState } from "../../../slots/context";
import styles from "../AgentWidget.module.scss";
import { useSlotRegistry } from "../../../plugin/PluginContext";

// ── Session content (chat/tools/terminals) ────────────────────────────────────
// Keyed by session ID so React resets local view state when switching sessions.

export function SessionContent({
  session,
  sessionId,
}: {
  session: AgentSession;
  sessionId: string;
}): ReactElement {
  const {
    id: sessionStateId,
    messages,
    isLoading,
    enableAttachments,
    subAgentRegistry,
    experiences,
    experienceStore,
    agentName,
    conversationId,
  } = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  const handleSend = useCallback(
    async (text: string, attachments?: readonly Attachment[]) => {
      // ToolSet-level interceptor hooks handle message queuing automatically
      // (e.g. pending-input plugin queues messages while the agent is busy).
      await session.sendMessage(text, attachments);
    },
    [session],
  );

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

  const [view, setView] = useState<
    | "chat"
    | "subagents"
    | "experience"
    | "tasks"
    | string
  >("chat");

  const { getByType } = useSlotRegistry();

  // Build SlotDisplayContext from session state for slot visibility decisions.
  const slotCtx = buildSlotDisplayContextFromState({ id: sessionStateId, agentName, conversationId });

  // Check if any plugin panel slots are visible.
  const hasPluginUi = getByType("panel")
    .some((s) => s.declaration.showTab(slotCtx));
  const hasSubAgents = subAgentRegistry !== null;

  function handleClear() {
    session.clearHistory();
  }

  return (
    <>
      {/* HeaderBar slots — thin full-width bars above the tab bar.
          Each slot is a sandboxed iframe that subscribes to session
          state changes. */}
      {getByType("headerBar")
        .map((entry) => (
          <SlotRenderer
            key={`${entry.pluginId}:${entry.slotId}`}
            pluginId={entry.pluginId}
            slotType="headerBar"
            slotId={entry.slotId}
            toolSetSymbol={entry.toolSetSymbol}
            session={session}
          />
        ))}
      <div className={styles["tab-bar"]}>
        <button
          type="button"
          className={`${styles["tab"]}${view === "chat" ? ` ${styles["tab--active"]}` : ""}`}
          onClick={() => setView("chat")}
        >
          Chat
        </button>
        {hasPluginUi && (
          <PluginTabBar
            activePluginView={view.startsWith("plugin:") ? view : null}
            onSelect={(v) => setView(v)}
            slotCtx={slotCtx}
          />
        )}
        {hasSubAgents && (
          <button
            type="button"
            className={`${styles["tab"]}${view === "subagents" ? ` ${styles["tab--active"]}` : ""}`}
            onClick={() => setView("subagents")}
          >
            Sub-Agents
          </button>
        )}
        <button
          type="button"
          className={`${styles["tab"]}${view === "experience" ? ` ${styles["tab--active"]}` : ""}`}
          onClick={() => setView("experience")}
        >
          Experience
          {experiences && experiences.length > 0 && (
            <span className={styles["tab-badge"]}>{experiences.length}</span>
          )}
        </button>
        {view === "chat" && messages.length > 0 && (
          <button
            type="button"
            className={styles["clear-btn"]}
            onClick={handleClear}
            title="Clear chat history"
          >
            Clear
          </button>
        )}
      </div>
      {/* ChatMessages + ChatInput are always mounted so the DOM preserves
          their scroll position when the user switches to another tab and back.
          We hide them via CSS (display:none) instead of unmounting.
          chat-panel gives the wrapper proper flex-child sizing so the inner
          .messages container is height-constrained and scrolls on its own. */}
      <div
        className={view === "chat" ? styles["chat-panel"] : styles["hidden"]}
      >
        <ChatMessages
          messages={messages}
          onEditMessage={handleEditMessage}
          session={session}
        />
        <ChatInput
          onSend={handleSend}
          onCancel={session.cancelMessage}
          isLoading={isLoading}
          enableAttachments={enableAttachments}
        />
      </div>
      {view.startsWith("plugin:") && (() => {
          const pid = view.slice("plugin:".length);
          const panelEntry = getByType("panel").find((e) => e.pluginId === pid);
          if (!panelEntry) return null;
          return (
            <SlotRenderer
              pluginId={panelEntry.pluginId}
              slotType="panel"
              slotId={panelEntry.slotId}
              toolSetSymbol={panelEntry.toolSetSymbol}
              session={session}
            />
          );
        })()}

      {/* SubAgentsPanel is always mounted when sub-agents exist so that
          RegistryView and ConversationPane stay subscribed across tab switches.
          Same display-none pattern as the chat panel above. */}
      {hasSubAgents && (
        <div
          className={
            view === "subagents" ? styles["chat-panel"] : styles["hidden"]
          }
        >
          <SubAgentsPanel registry={subAgentRegistry!} sessionId={sessionStateId} />
        </div>
      )}
      {view === "experience" && (
        <ExperiencePanel
          experiences={experiences ?? []}
          experienceStore={experienceStore}
        />
      )}
      {/* Inline prompt slots — plugin-managed user-input overlays.
          Each slot creates a sandboxed iframe that receives prompt state
          via InlinePromptHostMessage and calls the plugin's responder.
          Shown in all views so pending prompts never silently block execution. */}
      {getByType("inlinePrompt")
        .map((entry) => (
          <SlotRenderer
            key={`${entry.pluginId}:${entry.slotId}`}
            pluginId={entry.pluginId}
            slotType="inlinePrompt"
            slotId={entry.slotId}
            toolSetSymbol={entry.toolSetSymbol}
            session={session}
          />
        ))}
    </>
  );
}
