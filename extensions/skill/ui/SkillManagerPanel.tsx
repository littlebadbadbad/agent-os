/**
 * extensions/skill/ui/SkillManagerPanel.tsx
 *
 * Renders the skill management panel inside the iframe dropdown/panel slot.
 * Shows a list of installed skills with name, description, version, tool count.
 * Calls `sync()` on mount to refresh skill list from the backend.
 */

import { useEffect, type ReactElement } from "react";
import type { UiPluginHost } from "@agent-type";
import type { SkillState } from "../agent/types";
import styles from "./styles.module.scss";

export interface SkillManagerPanelProps {
  skills: readonly SkillState[];
  sync?: () => Promise<void>;
  host: UiPluginHost;
}

export function SkillManagerPanel({ skills, sync, host }: SkillManagerPanelProps): ReactElement {
  // Refresh skill list on mount and when the panel opens.
  useEffect(() => {
    if (sync) {
      sync().catch((err) =>
        console.error("[skill-panel] sync failed:", err),
      );
    }
  }, []);

  return (
    <div className={styles["panel"]}>
      <div className={styles["panel-header"]}>
        <span className={styles["panel-title"]}>🎞️ Installed Skills</span>
        <span className={styles["panel-count"]}>{skills.length}</span>
      </div>

      {skills.length === 0 && (
        <div className={styles["panel-empty"]}>
          No skills installed. Ask the agent to install a skill using
          the <code>install_skill</code> tool.
        </div>
      )}

      <div className={styles["panel-list"]}>
        {skills.map((skill) => (
          <div key={skill.name} className={styles["skill-item"]}>
            <div className={styles["skill-item-header"]}>
              <span className={styles["skill-item-name"]}>{skill.name}</span>
              {skill.version && (
                <span className={styles["skill-item-version"]}>v{skill.version}</span>
              )}
            </div>
            <div className={styles["skill-item-desc"]}>{skill.description}</div>
            <div className={styles["skill-item-meta"]}>
              <span className={styles["skill-item-tools"]}>
                {skill.toolCount} tool{skill.toolCount !== 1 ? "s" : ""}
                {skill.toolNames.length > 0 && (
                  <span className={styles["skill-item-tool-names"]}>
                    : {skill.toolNames.join(", ")}
                  </span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
