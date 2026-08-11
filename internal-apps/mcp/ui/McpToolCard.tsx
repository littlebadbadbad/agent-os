/**
 * internal-apps/mcp/ui/McpToolCard.tsx
 *
 * Full-size tool card for MCP management tool calls.
 * Renders tool-specific metadata for list_mcp_servers, add_mcp_server,
 * remove_mcp_server, connect_mcp_server, disable_mcp_server.
 */

import type { ReactElement } from "react";
import type { ToolCallInfo } from "@agent-type";
import styles from "./styles.module.scss";

// ── Per-operation metadata ────────────────────────────────────────────────────

const MCP_OP: Record<string, { icon: string; label: string }> = {
  list_mcp_servers:    { icon: "\uD83D\uDD0C", label: "List MCP Servers" },
  add_mcp_server:      { icon: "\uD83D\uDCE1", label: "Add MCP Server" },
  remove_mcp_server:   { icon: "\uD83D\uDDD1\uFE0F", label: "Remove MCP Server" },
  connect_mcp_server:  { icon: "\uD83D\uDD17", label: "Connect MCP Server" },
  disable_mcp_server:  { icon: "\u26D4", label: "Disable MCP Server" },
};

// ── Main card ─────────────────────────────────────────────────────────────────

export function McpToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const op = MCP_OP[name] ?? { icon: "\uD83D\uDD27", label: name };

  return (
    <div className={styles["tc-card"]}>
      <div className={styles["tc-header"]}>
        <span className={styles["tc-icon"]}>{op.icon}</span>
        <span className={styles["tc-title"]}>{op.label}</span>
        <span className={`${styles["tc-status"]} ${styles[`tc-status--${status}`]}`}>
          {status}
        </span>
      </div>

      {/* Arguments */}
      <div className={styles["tc-section"]}>
        <div className={styles["tc-section-title"]}>Arguments</div>
        <pre className={styles["tc-args"]}>
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>

      {/* Result or Error */}
      {status === "error" && !!error && (
        <div className={styles["tc-error"]}>
          <div className={styles["tc-error-title"]}>Error</div>
          <pre className={styles["tc-error-body"]}>{String(error)}</pre>
        </div>
      )}

      {status === "done" && !!result && (
        <div className={styles["tc-result"]}>
          <div className={styles["tc-section-title"]}>Result</div>
          <pre className={styles["tc-result-body"]}>
            {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
