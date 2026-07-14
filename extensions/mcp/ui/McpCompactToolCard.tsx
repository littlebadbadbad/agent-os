/**
 * extensions/mcp/ui/McpCompactToolCard.tsx
 *
 * Ultra-minimal single-line compact card for MCP tool calls.
 *
 * Design goal: one line of text, zero borders, zero chrome.
 * The entire row is clickable — clicking sends `openDetail` to the
 * host so the full McpToolCard renders in the detail modal.
 */

import { type ReactElement } from "react";
import type {
  ToolCallInfo,
  UiPluginHost,
  SlotIframeMessage,
} from "@agent-type";

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

// ── Per-operation short labels ────────────────────────────────────────────────

const SHORT_LABEL: Record<string, string> = {
  list_mcp_servers: "List MCP Servers",
  add_mcp_server: "Add MCP Server",
  remove_mcp_server: "Remove MCP Server",
  connect_mcp_server: "Connect MCP Server",
  disable_mcp_server: "Disable MCP Server",
};

// ── One-line summary extractor ────────────────────────────────────────────────

function oneLineSummary(info: ToolCallInfo): string {
  const { name, arguments: args, status, result, error } = info;

  if (status === "error" && error) {
    const short = error.split("\n")[0];
    return short.length > 60 ? `${short.slice(0, 60)}\u2026` : short;
  }

  const label = SHORT_LABEL[name] ?? name;

  switch (name) {
    case "list_mcp_servers": {
      if (status === "running") return "Listing MCP servers\u2026";
      const count = arrLen(result);
      return `${count} MCP server${count !== 1 ? "s" : ""}`;
    }
    case "add_mcp_server": {
      const serverName = str(args?.name);
      if (status === "running") return `Adding ${serverName ?? "server"}…`;
      return `${serverName ?? "Server"} added`;
    }
    case "remove_mcp_server": {
      const serverName = str(args?.name);
      if (status === "running") return `Removing ${serverName ?? "server"}…`;
      return `${serverName ?? "Server"} removed`;
    }
    case "connect_mcp_server": {
      const serverName = str(args?.name);
      if (status === "running") return `Connecting ${serverName ?? "server"}…`;
      return `${serverName ?? "Server"} connected`;
    }
    case "disable_mcp_server": {
      const serverName = str(args?.name);
      if (status === "running")
        return `Disabling ${serverName ?? "server"}\u2026`;
      return `${serverName ?? "Server"} disabled`;
    }
    default:
      return label;
  }
}

// ── Compact card ──────────────────────────────────────────────────────────────

export interface McpCompactToolCardProps {
  info: ToolCallInfo;
  host: UiPluginHost;
}

export function McpCompactToolCard({
  info,
  host,
}: McpCompactToolCardProps): ReactElement {
  const summary = oneLineSummary(info);

  const handleClick = () => {
    host.sendSlotMessage({
      version: 1,
      source: "compactToolCard",
      type: "openDetail",
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
      <span>{"\uD83D\uDD0C"}</span>
      <span>{summary}</span>
      {info.status === "running" && (
        <span style={{ color: "#0ea5e9" }}>{"\u25CF"}</span>
      )}
      {info.status === "done" && (
        <span style={{ color: "#22c55e" }}>{"\u2713"}</span>
      )}
      {info.status === "error" && (
        <span style={{ color: "#ef4444" }}>{"\u2717"}</span>
      )}
    </div>
  );
}
