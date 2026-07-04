import { useState } from "react";
import type { ReactElement } from "react";
import type { ToolCallInfo } from "../types";
import type { TokenBudgetState } from "@agent-sdk";
import { FileToolCard } from "./toolCards/FileToolCard";
import { TerminalToolCard } from "./toolCards/TerminalToolCard";
import { TodoToolCard } from "./toolCards/TodoToolCard";
import { AskUserCard } from "./toolCards/AskUserCard";
import { DynamicToolCard } from "./toolCards/DynamicToolCard";
import { McpToolCard } from "./toolCards/McpToolCard";
import { SkillToolCard } from "./toolCards/SkillToolCard";
import { SubAgentMetaCard } from "./toolCards/SubAgentMetaCard";
import { ExperienceToolCard } from "./toolCards/ExperienceToolCard";
import { PluginSlot } from "../plugin/PluginSlot";
import {
  CardShell,
  CardHeader,
  ErrorResult,
  PlainResult,
  formatResult,
  getToolMeta,
  getCompactSummary,
} from "./toolCards/shared";
import {
  isFileTool,
  isTerminalTool,
  isTodoTool,
  isAskUserTool,
  isDynamicTool,
  isMcpTool,
  isSkillTool,
  isSubAgentMetaTool,
  isExperienceTool,
} from "./toolCards/identifiers";
import { pluginSystem } from "../../../agents";
import { CompactToolCard } from "./CompactToolCard";
import { ToolCardModal } from "./ToolCardModal";
import styles from "../AgentWidget.module.scss";

export { formatResult };

// ── Generic fallback card (used in detail modal only) ─────────────────────────

function GenericCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;

  const hasArgs = Object.keys(args).length > 0;
  const argsJson = hasArgs ? JSON.stringify(args, null, 2) : null;
  const argsLineCount = argsJson ? argsJson.split("\n").length : 0;
  const isLargeArgs = argsLineCount > 4;

  const [argsExpanded, setArgsExpanded] = useState(!isLargeArgs);

  return (
    <CardShell family="file">
      <CardHeader
        icon="⚙"
        label={name}
        status={status}
        badge={
          hasArgs && isLargeArgs ? (
            <button
              className={styles["tool-args-toggle"]}
              onClick={() => setArgsExpanded((v) => !v)}
              aria-expanded={argsExpanded}
            >
              {argsExpanded ? "▼ args" : "▶ args"}
            </button>
          ) : undefined
        }
      />
      {hasArgs && argsExpanded && (
        <div className={styles["tool-args"]}>
          <pre>{argsJson}</pre>
        </div>
      )}
      {status !== "running" &&
        (error ? (
          <ErrorResult error={error} />
        ) : (
          <PlainResult result={result} />
        ))}
    </CardShell>
  );
}

// ── Detail card dispatcher ────────────────────────────────────────────────────
//
// Renders the full specialized card for display inside the modal.

function renderDetailCard(info: ToolCallInfo): ReactElement {
  const { name } = info;
  if (isFileTool(name)) return <FileToolCard info={info} />;
  if (isTerminalTool(name)) return <TerminalToolCard info={info} />;
  if (isTodoTool(name)) return <TodoToolCard info={info} />;
  if (isAskUserTool(name)) return <AskUserCard info={info} />;
  if (isDynamicTool(name)) return <DynamicToolCard info={info} />;
  if (isMcpTool(name)) return <McpToolCard info={info} />;
  if (isSkillTool(name)) return <SkillToolCard info={info} />;
  if (isSubAgentMetaTool(name)) return <SubAgentMetaCard info={info} />;
  if (isExperienceTool(name)) return <ExperienceToolCard info={info} />;

  // Generic plugin tool-card path: derive plugin name from tool name
  // convention (`<pluginName>_<action>` → split on first underscore).
  // If the derived plugin has a UI entry, render via PluginSlot toolCard mode.

  const uiPlugin = pluginSystem.activePlugins.find((p) =>
    p.tools.includes(name),
  );
  if (uiPlugin) {
    return (
      <PluginSlot
        pluginId={uiPlugin.id}
        panelType="toolCard"
        toolCallInfo={info}
      />
    );
  }

  return <GenericCard info={info} />;
}

// ── Public component ──────────────────────────────────────────────────────────

export function ToolCallCard({ info }: { info: ToolCallInfo }): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  const meta = getToolMeta(info.name);
  const summary = getCompactSummary(info);
  const modalTitle = `${meta.icon} ${meta.label}${summary ? `  ${summary}` : ""}`;

  return (
    <>
      <CompactToolCard info={info} onOpen={() => setIsOpen(true)} />
      {isOpen && (
        <ToolCardModal title={modalTitle} onClose={() => setIsOpen(false)}>
          {renderDetailCard(info)}
        </ToolCardModal>
      )}
    </>
  );
}
