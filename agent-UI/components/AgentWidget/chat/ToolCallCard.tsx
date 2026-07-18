import { useState } from "react";
import type { ReactElement } from "react";
import type { ToolCallInfo } from "../types";
import type { SlotSession } from "@agent-type";
import { SubAgentMetaCard } from "./toolCards/SubAgentMetaCard";
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
  isSubAgentMetaTool,
} from "./toolCards/identifiers";
import { CompactToolCard } from "./CompactToolCard";
import { ToolCardModal } from "./ToolCardModal";
import styles from "../AgentWidget.module.scss";
import { useSlotRegistry } from "../../../plugin/PluginContext";

export { formatResult };

// ── Dev-mode helpers ──────────────────────────────────────────────────────────

const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

function devCopy(info: ToolCallInfo): void {
  if (!IS_DEV) return;
  const data = JSON.stringify({
    name: info.name,
    arguments: info.arguments,
    result: info.result,
    error: info.error,
  }, null, 2);
  void navigator.clipboard.writeText(data).catch(() => { /* ignore */ });
}

// ── Generic fallback card (used in detail modal only) ─────────────────────────

function GenericCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;

  const hasArgs = args ? Object.keys(args).length > 0 : false;
  const argsJson = hasArgs ? JSON.stringify(args, null, 2) : null;
  const argsLineCount = argsJson ? argsJson.split("\n").length : 0;
  const isLargeArgs = argsLineCount > 4;

  const [argsExpanded, setArgsExpanded] = useState(!isLargeArgs);

  return (
    <CardShell family="generic">
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
      {IS_DEV && (
        <button
          type="button"
          className={styles["dev-copy-btn-compact"]}
          style={{ position: "absolute", top: 4, right: 4 }}
          title="Copy tool call data (dev mode)"
          onClick={() => devCopy(info)}
        >
          {"\u{1F4CB}"}
        </button>
      )}
    </CardShell>
  );
}

// ── Detail card dispatcher ────────────────────────────────────────────────────
//
// Renders the full specialized card for display inside the modal.

function DetailCard({ info, session }: { info: ToolCallInfo; session: SlotSession }): ReactElement {
  const { getByType } = useSlotRegistry();
  const { name } = info;

  // Plugin tool-card slot: if a plugin declares a toolCard slot whose
  // toolNames include this tool, route to the plugin's iframe renderer.

  const slot = getByType('toolCard')
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

  // Non-plugin tools (sub-agent meta-operations).
  if (isSubAgentMetaTool(name)) return <SubAgentMetaCard info={info} />;

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
