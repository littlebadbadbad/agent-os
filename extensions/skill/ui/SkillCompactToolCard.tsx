/**
 * extensions/skill/ui/SkillCompactToolCard.tsx
 *
 * Ultra-minimal single-line compact card for skill tool calls.
 *
 * Design goal: one line of text, zero borders, zero chrome.
 * The entire row is clickable — clicking sends `openDetail` to the
 * host so the full SkillToolCard renders in the detail modal.
 */

import { type ReactElement } from "react";
import type { ToolCallInfo, UiPluginHost } from "@agent-type";

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

// ── Per-operation short labels ────────────────────────────────────────────────

const SHORT_LABEL: Record<string, string> = {
  install_skill:    "Install Skill",
  list_skills:      "List Skills",
  remove_skill:     "Remove Skill",
  read_skill_file:  "Read File",
};

// ── One-line summary extractor ────────────────────────────────────────────────

function oneLineSummary(info: ToolCallInfo): string {
  const { name, arguments: args, status, result, error } = info;

  if (status === "error" && error) {
    const short = error.split("\n")[0];
    return short.length > 60 ? `${short.slice(0, 60)}…` : short;
  }

  const label = SHORT_LABEL[name] ?? name;

  switch (name) {
    case "install_skill": {
      const url = str(args?.url);
      const skillName = str(args?.name);
      const target = url ?? skillName ?? "?";
      if (status === "running") return `Installing ${target}…`;
      const installed = typeof result === "object" && result !== null
        ? String(Reflect.get(result, "installed") ?? "")
        : undefined;
      return installed ? `Installed ${installed}` : `Installed ${target}`;
    }
    case "list_skills": {
      if (status === "running") return "Listing skills…";
      const count = arrLen(result);
      return `${count} skill${count !== 1 ? "s" : ""} installed`;
    }
    case "remove_skill": {
      const skillName = str(args?.name);
      if (status === "running") return `Removing ${skillName ?? "skill"}…`;
      return `${skillName ?? "Skill"} removed`;
    }
    case "read_skill_file": {
      const skill = str(args?.skill);
      const path = str(args?.path);
      if (status === "running") return `Reading ${skill}/${path}…`;
      return `${skill}/${path}`;
    }
    default:
      return label;
  }
}

// ── Compact card ──────────────────────────────────────────────────────────────

export interface SkillCompactToolCardProps {
  info: ToolCallInfo;
  host: UiPluginHost;
}

export function SkillCompactToolCard({ info, host }: SkillCompactToolCardProps): ReactElement {
  const summary = oneLineSummary(info);

  const handleClick = () => {
    host.sendSlotMessage({
      version: 1,
      type: "openDetail",
      source: "compactToolCard",
      payload: { toolCallId: info.toolCallId },
    });
  };

  return (
    <div
      onClick={handleClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        cursor: "pointer",
        color: "#cccccc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 12,
        lineHeight: "20px",
        userSelect: "none",
      }}
    >
      <span>🔧</span>
      <span>{summary}</span>
      {info.status === "running" && (
        <span style={{ color: "#0ea5e9" }}>●</span>
      )}
      {info.status === "done" && (
        <span style={{ color: "#22c55e" }}>✓</span>
      )}
      {info.status === "error" && (
        <span style={{ color: "#ef4444" }}>✗</span>
      )}
    </div>
  );
}
