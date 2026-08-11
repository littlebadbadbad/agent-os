/**
 * agent-UI/appManager/AppRow.tsx — Single app row in the manager list
 */

import { type ReactElement } from "react";
import type { AppDescriptor } from "../app/appTypes";
import styles from "./AppManagerPanel.module.scss";

interface AppRowProps {
  readonly app: AppDescriptor;
  readonly pending: boolean;
  readonly onToggle: (app: AppDescriptor) => void;
  readonly onUninstall: (appId: string) => void;
}

export function AppRow({
  app,
  pending,
  onToggle,
  onUninstall,
}: AppRowProps): ReactElement {
  const isActive = app.state === "active";
  const toggleDisabled = app.canDisable === false;
  const canUninstall = !app.builtIn;

  return (
    <div className={`${styles.row} ${isActive ? styles.rowActive : ""}`}>
      <div className={styles.rowInfo}>
        <div className={styles.rowName}>
          {app.name}
          {app.builtIn && <span className={styles.badge}>built-in</span>}
        </div>
        <div className={styles.rowDesc}>
          {app.description || "No description"}
        </div>
        <div className={styles.rowMeta}>
          <span>v{app.version}</span>
          <span className={styles.sep}>·</span>
          <span className={app.state === "error" ? styles.stateError : ""}>
            {app.state}
          </span>
          {app.hasAgentEntry && <><span className={styles.sep}>·</span><span>agent</span></>}
          {app.hasUiEntry && <><span className={styles.sep}>·</span><span>ui</span></>}
        </div>
      </div>
      <div className={styles.rowActions}>
        {canUninstall && (
          <button
            className={styles.uninstallBtn}
            disabled={pending}
            onClick={() => onUninstall(app.id)}
            title="Uninstall this app"
          >
            Uninstall
          </button>
        )}
        <button
          className={`${styles.toggle} ${isActive ? styles.toggleOn : ""}`}
          disabled={toggleDisabled || pending}
          onClick={() => onToggle(app)}
          title={toggleDisabled ? "This app cannot be disabled" : undefined}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>
    </div>
  );
}
