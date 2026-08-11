/**
 * internal-apps/user-input/ui/prompts/NumberPrompt.tsx — Number input
 */

import { type ReactElement, useState, useEffect, useCallback } from "react";
import type { PromptComponentProps } from "./types";
import styles from "../UserInputPrompt.module.scss";

export function NumberPrompt({
  prompt,
  onRespond,
  inputState,
  onInputStateChange,
}: PromptComponentProps): ReactElement {
  // ── Local state for responsive typing ──
  const [localValue, setLocalValue] = useState<string>(
    () => inputState.textValue
  );

  // Persist to parent ref on every change.
  useEffect(() => {
    onInputStateChange({ ...inputState, textValue: localValue });
  }, [localValue]);

  const handleSubmit = useCallback(() => {
    onRespond(localValue || null);
  }, [localValue, onRespond]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
    },
    [handleSubmit],
  );

  return (
    <div>
      <p className={styles.promptMessage}>{prompt.message}</p>
      <div className={styles.promptInputRow}>
        <input
          type="number"
          value={localValue}
          placeholder={prompt.placeholder}
          min={prompt.min}
          max={prompt.max}
          step={prompt.step}
          onChange={(e) => setLocalValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={styles.promptInput}
          autoFocus
        />
        <button
          type="button"
          onClick={handleSubmit}
          className={`${styles.promptBtn} ${styles.promptBtnPrimary}`}
        >
          Submit
        </button>
      </div>
    </div>
  );
}
