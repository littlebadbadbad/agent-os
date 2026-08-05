/**
 * internal-plugins/user-input/ui/prompts/SelectPrompt.tsx — Single-select from options
 */

import type { ReactElement } from "react";
import type { PromptComponentProps } from "./types";
import styles from "../UserInputPrompt.module.scss";

export function SelectPrompt({
  prompt,
  onRespond,
}: PromptComponentProps): ReactElement {
  const options = prompt.options ?? [];

  return (
    <div>
      <p className={styles.promptMessage}>{prompt.message}</p>
      <div className={styles.promptOptions}>
        {options.map((opt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onRespond(opt)}
            className={styles.promptOption}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
