/**
 * extensions/user-input/ui/prompts/ConfirmPrompt.tsx — Yes/No confirmation
 */

import type { ReactElement } from "react";
import type { PromptComponentProps } from "./types";
import styles from "../UserInputPrompt.module.scss";

export function ConfirmPrompt({
  prompt,
  onRespond,
}: PromptComponentProps): ReactElement {
  return (
    <div>
      <p className={styles.promptMessage}>{prompt.message}</p>
      <div className={styles.promptBtnRow}>
        <button
          type="button"
          onClick={() => onRespond("yes")}
          className={`${styles.promptBtn} ${styles.promptBtnPrimary}`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onRespond("no")}
          className={`${styles.promptBtn} ${styles.promptBtnDefault}`}
        >
          No
        </button>
      </div>
    </div>
  );
}
