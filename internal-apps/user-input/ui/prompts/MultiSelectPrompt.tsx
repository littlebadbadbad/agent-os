/**
 * internal-apps/user-input/ui/prompts/MultiSelectPrompt.tsx — Multi-select checkboxes
 */

import { type ReactElement, useState, useEffect, useCallback } from "react";
import type { PromptComponentProps } from "./types";
import styles from "../UserInputPrompt.module.scss";

export function MultiSelectPrompt({
  prompt,
  onRespond,
  inputState,
  onInputStateChange,
}: PromptComponentProps): ReactElement {
  const options = prompt.options ?? [];

  // ── Local state for responsive checkbox toggling ──
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(inputState.selectedOptions)
  );

  // Persist to parent ref on every change.
  useEffect(() => {
    onInputStateChange({ ...inputState, selectedOptions: selected });
  }, [selected]);

  const minSelect = prompt.minSelect ?? 1;
  const canSubmit =
    selected.size >= minSelect &&
    (!prompt.maxSelect || selected.size <= prompt.maxSelect);

  const toggle = useCallback((opt: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) {
        next.delete(opt);
      } else {
        next.add(opt);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    onRespond(JSON.stringify([...selected]));
  }, [selected, onRespond]);

  return (
    <div>
      <p className={styles.promptMessage}>{prompt.message}</p>
      <p className={styles.promptMultiHint}>
        Select at least {prompt.minSelect ?? 1}
        {prompt.maxSelect ? `, at most ${prompt.maxSelect}` : ""}
      </p>
      <div className={styles.promptMultiOptions}>
        {options.map((opt, i) => {
          const isSelected = selected.has(opt);
          return (
            <label
              key={i}
              className={`${styles.promptCheckbox} ${isSelected ? styles.promptCheckboxSelected : ""}`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(opt)}
              />
              {opt}
            </label>
          );
        })}
      </div>
      <div className={styles.promptSubmitArea}>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className={`${styles.promptBtn} ${styles.promptBtnPrimary}`}
        >
          Submit
        </button>
        <span className={styles.promptSubmitCount}>
          {selected.size} selected
        </span>
      </div>
    </div>
  );
}
