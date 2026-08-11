/**
 * agent-UI/appManager/InstallDropdown.tsx — Install app dropdown menu
 */

import { type ReactElement } from "react";
import styles from "./AppManagerPanel.module.scss";

interface InstallDropdownProps {
  readonly onInstallFromZip: () => void;
  readonly onInstallFromFolder: () => void;
  readonly onClose: () => void;
}

export function InstallDropdown({
  onInstallFromZip,
  onInstallFromFolder,
  onClose,
}: InstallDropdownProps): ReactElement {
  return (
    <div className={styles.installMenu}>
      <button className={styles.installMenuItem} onClick={onInstallFromZip}>
        Install from ZIP
      </button>
      <button className={styles.installMenuItem} onClick={onInstallFromFolder}>
        Install from Folder
      </button>
      <button className={styles.installMenuCancel} onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
