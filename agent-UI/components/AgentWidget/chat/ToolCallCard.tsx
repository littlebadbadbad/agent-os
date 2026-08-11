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
import { SlotToolCard } from "./SlotToolCard";
import { ToolCallInlineCard } from "./ToolCallInlineCard";
import { ToolCardModal } from "./ToolCardModal";
import styles from "../AgentWidget.module.scss";
import { useSlotRegistry } from "../../../app/AppContext";

export { formatResult };

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
    </CardShell>
  );
}

// ── Detail card dispatcher ────────────────────────────────────────────────────
//
// Renders the full specialized card for display inside the modal.

function DetailCard({ info, session }: { info: ToolCallInfo; session: SlotSession }): ReactElement {
  const { getByType } = useSlotRegistry();
  const { name } = info;

  // App tool-card slot: if a app declares a toolCard slot whose
  // toolNames include this tool, route to the app's iframe renderer.

  const slot = getByType('toolCard')
      .find((entry) => entry.declaration.toolNames.includes(info.name));
  if (slot) {
    return (
      <SlotRenderer
        appId={slot.appId}
        slotType="toolCard"
        slotId={slot.slotId}
        toolSetSymbol={slot.toolSetSymbol}
        session={session}
        toolCallInfo={info}
      />
    );
  }

  // Non-app tools (sub-agent meta-operations).
  if (isSubAgentMetaTool(name)) return <SubAgentMetaCard info={info} />;

  return <GenericCard info={info} />;
}

// ── Public component ──────────────────────────────────────────────────────────

export function ToolCallCard({ info, session }: { info: ToolCallInfo; session: SlotSession }): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const { getByType } = useSlotRegistry();

  // Apps may declare a compactToolCard slot to claim specific tools;
  // those render via SlotToolCard, everything else uses the default inline
  // execution note.
  const slotCard = getByType('compactToolCard')
    .find((entry) => entry.declaration.toolNames.includes(info.name));

  const meta = getToolMeta(info.name);
  const summary = getCompactSummary(info);
  const modalTitle = `${meta.icon} ${meta.label}${summary ? `  ${summary}` : ""}`;

  const openModal = (): void => setIsOpen(true);

  return (
    <>
      {slotCard ? (
        <SlotToolCard slot={slotCard} info={info} onOpen={openModal} />
      ) : (
        <ToolCallInlineCard info={info} onOpen={openModal} />
      )}
      {isOpen && (
        <ToolCardModal title={modalTitle} onClose={() => setIsOpen(false)}>
          <DetailCard info={info} session={session} />
        </ToolCardModal>
      )}
    </>
  );
}
