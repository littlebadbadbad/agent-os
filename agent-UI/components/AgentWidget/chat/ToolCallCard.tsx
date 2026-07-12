import { useState } from "react";
import type { ReactElement } from "react";
import type { ToolCallInfo } from "../types";
import type { SlotSession } from "@agent-type";
import { FileToolCard } from "./toolCards/FileToolCard";
import { AskUserCard } from "./toolCards/AskUserCard";
import { DynamicToolCard } from "./toolCards/DynamicToolCard";
import { McpToolCard } from "./toolCards/McpToolCard";
import { SkillToolCard } from "./toolCards/SkillToolCard";
import { SubAgentMetaCard } from "./toolCards/SubAgentMetaCard";
import { ExperienceToolCard } from "./toolCards/ExperienceToolCard";
import { SlotRenderer } from "../../../slots/SlotRenderer";
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
import { slotRegistry } from "@agent-UI/slots/registry";

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

function DetailCard({ info, session }: { info: ToolCallInfo; session: SlotSession }): ReactElement {
  const { name } = info;
  if (isFileTool(name)) return <FileToolCard info={info} />;
  if (isAskUserTool(name)) return <AskUserCard info={info} />;
  if (isDynamicTool(name)) return <DynamicToolCard info={info} />;
  if (isMcpTool(name)) return <McpToolCard info={info} />;
  if (isSkillTool(name)) return <SkillToolCard info={info} />;
  if (isSubAgentMetaTool(name)) return <SubAgentMetaCard info={info} />;
  if (isExperienceTool(name)) return <ExperienceToolCard info={info} />;

  // Generic plugin tool-card path: match tool name to plugin.

  const slot = slotRegistry
      .getByType('toolCard')
      .find((entry) => entry.declaration.toolNames.includes(info.name));
  if (slot) {
    return (
      <SlotRenderer
        pluginId={slot.pluginId}
        slotType="toolCard"
        slotId={slot.slotId}
        toolSetSymbol={slot.toolSetSymbol}
        session={session}
        toolCallInfo={info}
      />
    );
  }

  return <GenericCard info={info} />;
}

// ── Public component ──────────────────────────────────────────────────────────

export function ToolCallCard({ info, session }: { info: ToolCallInfo; session: SlotSession }): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  const meta = getToolMeta(info.name);
  const summary = getCompactSummary(info);
  const modalTitle = `${meta.icon} ${meta.label}${summary ? `  ${summary}` : ""}`;

  return (
    <>
      <CompactToolCard info={info} onOpen={() => setIsOpen(true)} session={session} />
      {isOpen && (
        <ToolCardModal title={modalTitle} onClose={() => setIsOpen(false)}>
          <DetailCard info={info} session={session} />
        </ToolCardModal>
      )}
    </>
  );
}
