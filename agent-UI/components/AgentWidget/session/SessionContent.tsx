import { useSyncExternalStore, useState, useCallback } from "react";
import type { ReactElement } from "react";
import type { Attachment, AgentSession } from "@agent-sdk";
import { ChatMessages } from "../chat/ChatMessages";
import { ChatInput } from "../chat/ChatInput";
import { ToolsPanel } from "../panels/ToolsPanel";
import { TodoPanel } from "../panels/TodoPanel";
import { TokenProgressBar } from "../panels/TokenProgress";
import { UserInputPrompt } from "../panels/UserInputPrompt";
import { TerminalPanel } from "../panels/TerminalPanel";
import { SubAgentsPanel } from "../panels/SubAgentsPanel";
import { ExperiencePanel } from "../panels/ExperiencePanel";
import { PlanPanel } from "../panels/PlanPanel";
import { CronPanel } from "../panels/CronPanel";
import { PluginTabBar } from "../plugin/PluginTabBar";
import { PluginSlot } from "../plugin/PluginSlot";
import styles from "../AgentWidget.module.scss";
import { pick } from "@agent-UI/utils";
import { pluginSystem } from "@agent-UI/agents";

// ── Session content (inner chat/tools/todo/terminals) ─────────────────────────
// Keyed by session ID so React resets local view state when switching sessions.

export function SessionContent({
  session,
  sessionId,
}: {
  session: AgentSession;
  sessionId: string;
}): ReactElement {
  const {
    messages,
    isLoading,
    toolStates,
    skills,
    tokenBudget,
    todos,
    terminalAdapter,
    enableAttachments,
    pendingUserInputs,
    respondUserInput,
    toggleTool,
    subAgentRegistries,
    experiences,
    experienceStore,
    plan,
    queueUserInput,
    pendingInputCount,
    pendingInputMessages,
    cancelQueuedInput,
    resumeQueuedInputs,
    cronJobs,
    cronPauseJob,
    cronResumeJob,
    cronDeleteJob,
    ...pluginStates
  } = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  const handleSend = useCallback(
    async (text: string, attachments?: readonly Attachment[]) => {
      if (isLoading && queueUserInput) {
        // Agent is busy — queue the message for the next loop iteration.
        queueUserInput(text);
      } else {
        await session.sendMessage(text, attachments);
      }
    },
    [session, isLoading, queueUserInput],
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
    | "tools"
    | "plan"
    | "todo"
    | "terminals"
    | "subagents"
    | "experience"
    | "cron"
    | "tasks"
    | string
  >("chat");
  const hasPlan = !!plan;
  const hasTerminals = terminalAdapter !== undefined;
  const hasPluginUi = pluginSystem.activePlugins.some((p) =>
    p.symbols.some((s) => pluginStates[s]?.showTab?.()),
  ); // any active plugin has a UI state (and thus a UI entry)
  const hasSubAgents = subAgentRegistries.length > 0;
  const hasCron = (cronJobs?.length ?? 0) > 0;
  const enabledCount = toolStates.filter((t) => t.enabled).length;
  const hasTodos = todos.length > 0;
  const todosDone = todos.filter((t) => t.status === "completed").length;
  const todosActive = todos.filter((t) => t.status === "in-progress").length;

  function handleClear() {
    session.clearHistory();
  }

  return (
    <>
      {tokenBudget &&
        tokenBudget.maxTokens > 0 &&
        tokenBudget.turnCount > 0 && <TokenProgressBar state={tokenBudget} />}
      <div className={styles["tab-bar"]}>
        <button
          type="button"
          className={`${styles["tab"]}${view === "chat" ? ` ${styles["tab--active"]}` : ""}`}
          onClick={() => setView("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className={`${styles["tab"]}${view === "tools" ? ` ${styles["tab--active"]}` : ""}`}
          onClick={() => setView("tools")}
        >
          Tools
          {toolStates.length > 0 && (
            <span className={styles["tab-badge"]}>
              {enabledCount}/{toolStates.length}
            </span>
          )}
        </button>
        {hasPlan && (
          <button
            type="button"
            className={`${styles["tab"]}${view === "plan" ? ` ${styles["tab--active"]}` : ""}`}
            onClick={() => setView("plan")}
          >
            Plan
            {(pendingUserInputs?.length ?? 0) > 0 && (
              <span
                className={`${styles["tab-badge"]} ${styles["tab-badge--urgent"]}`}
              >
                !
              </span>
            )}
          </button>
        )}
        {hasTodos && (
          <button
            type="button"
            className={`${styles["tab"]}${view === "todo" ? ` ${styles["tab--active"]}` : ""}`}
            onClick={() => setView("todo")}
          >
            Todo
            {todos.length > 0 && (
              <span className={styles["tab-badge"]}>
                {todosActive > 0
                  ? `${todosDone}/${todos.length} ◎`
                  : `${todosDone}/${todos.length}`}
              </span>
            )}
          </button>
        )}
        {hasTerminals && (
          <button
            type="button"
            className={`${styles["tab"]}${view === "terminals" ? ` ${styles["tab--active"]}` : ""}`}
            onClick={() => setView("terminals")}
          >
            Terminals
          </button>
        )}
        {hasCron && (
          <button
            type="button"
            className={`${styles["tab"]}${view === "cron" ? ` ${styles["tab--active"]}` : ""}`}
            onClick={() => setView("cron")}
          >
            Cron
            <span className={styles["tab-badge"]}>{cronJobs!.length}</span>
          </button>
        )}
        {hasPluginUi && (
          <PluginTabBar
            pluginStates={pluginStates}
            activePluginView={view.startsWith("plugin:") ? view : null}
            onSelect={(v) => setView(v)}
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
          tokenBudget={tokenBudget}
          onEditMessage={handleEditMessage}
        />
        {/* Pending messages (queued during agent loop) shown as ghost bubbles */}
        {pendingInputMessages && pendingInputMessages.length > 0 && (
          <div className={styles["pending-strip"]}>
            {pendingInputMessages.map((entry) => (
              <div key={entry.id} className={styles["pending-msg"]}>
                <span className={styles["pending-msg-icon"]}>⏳</span>
                <span className={styles["pending-msg-text"]}>{entry.text}</span>
                {cancelQueuedInput && (
                  <button
                    type="button"
                    className={styles["pending-msg-cancel"]}
                    onClick={() => cancelQueuedInput(entry.id)}
                    title="Remove this message"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {!isLoading && resumeQueuedInputs && (
              <button
                type="button"
                className={styles["pending-resume-btn"]}
                onClick={resumeQueuedInputs}
              >
                继续发送全部
              </button>
            )}
          </div>
        )}
        <ChatInput
          onSend={handleSend}
          onCancel={session.cancelMessage}
          isLoading={isLoading}
          disabled={
            (pendingUserInputs?.length ?? 0) > 0 ||
            (!isLoading && (pendingInputMessages?.length ?? 0) > 0)
          }
          enableAttachments={enableAttachments}
          skills={skills}
          pendingCount={pendingInputCount}
        />
      </div>
      {view === "tools" && (
        <ToolsPanel
          toolStates={toolStates}
          onToggle={(name) => toggleTool?.(name)}
        />
      )}
      {view === "terminals" && terminalAdapter && (
        <TerminalPanel adapter={terminalAdapter} sessionId={sessionId} />
      )}
      {view === "cron" && (
        <CronPanel
          jobs={cronJobs ?? []}
          onPause={cronPauseJob}
          onResume={cronResumeJob}
          onDelete={cronDeleteJob}
        />
      )}
      {view.startsWith("plugin:") && (
        <PluginSlot
          pluginId={view.slice("plugin:".length)}
          panelType="main"
          sessionId={sessionId}
          session={session}
        />
      )}

      {view === "plan" && plan && <PlanPanel plan={plan} />}
      {view === "todo" && <TodoPanel todos={todos} />}
      {/* SubAgentsPanel is always mounted when sub-agents exist so that
          RegistryView and ConversationPane stay subscribed across tab switches.
          Same display-none pattern as the chat panel above. */}
      {hasSubAgents && (
        <div
          className={
            view === "subagents" ? styles["chat-panel"] : styles["hidden"]
          }
        >
          <SubAgentsPanel registries={subAgentRegistries} />
        </div>
      )}
      {view === "experience" && (
        <ExperiencePanel
          experiences={experiences ?? []}
          experienceStore={experienceStore}
        />
      )}
      {/* Pending user-input prompt — shown in all views so a tool paused in the
          background never silently blocks execution when the user switches tabs.
          Multiple simultaneous prompts are possible (e.g. main agent + sub-agent);
          we surface the oldest one first and let the user work through them. */}
      {pendingUserInputs?.[0] && respondUserInput && (
        <UserInputPrompt
          pending={pendingUserInputs[0]}
          onRespond={respondUserInput}
        />
      )}
    </>
  );
}
