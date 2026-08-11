/**
 * internal-apps/skill/ui/SkillToolCard.tsx
 *
 * Full-size tool card for skill management tool calls.
 * Renders tool-specific metadata for install_skill, list_skills, remove_skill, read_skill_file.
 */

import type { ReactElement } from "react";
import type { ToolCallInfo } from "@agent-type";
import styles from "./styles.module.scss";

// ── Per-operation metadata ────────────────────────────────────────────────────

const SKILL_OP: Record<string, { icon: string; label: string }> = {
  install_skill:    { icon: '📦', label: 'Install Skill' },
  list_skills:      { icon: '📋', label: 'List Skills' },
  remove_skill:     { icon: '🗑️', label: 'Remove Skill' },
  read_skill_file:  { icon: '📄', label: 'Read Skill File' },
};

// ── Main card ─────────────────────────────────────────────────────────────────

export function SkillToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const op = SKILL_OP[name] ?? { icon: '🔧', label: name };

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
      {status === 'error' && !!error && (
        <div className={styles["tc-error"]}>
          <div className={styles["tc-error-title"]}>Error</div>
          <pre className={styles["tc-error-body"]}>{String(error)}</pre>
        </div>
      )}

      {status === 'done' && !!result && (
        <div className={styles["tc-result"]}>
          <div className={styles["tc-section-title"]}>Result</div>
          <pre className={styles["tc-result-body"]}>
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
