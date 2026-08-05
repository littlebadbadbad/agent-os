/**
 * internal-plugins/user-input/ui/prompts/TextPrompt.tsx — Free-text input
 */

import { type ReactElement, useState, useEffect, useCallback } from "react";
import type { PromptComponentProps } from "./types";
import styles from "../UserInputPrompt.module.scss";

export function TextPrompt({
  prompt,
  onRespond,
  inputState,
  onInputStateChange,
}: PromptComponentProps): ReactElement {
  // ── Local state for responsive typing ──
  // Initialize from persisted inputState; subsequent changes driven by local state.
  const [localValue, setLocalValue] = useState<string>(
    () => inputState.textValue
  );

  // Persist to parent ref on every change (for cross-prompt navigation).
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
          type="text"
          value={localValue}
          placeholder={prompt.placeholder}
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
