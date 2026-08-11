/**
 * internal-apps/user-input/ui/UserInputPrompt.tsx — Inline prompt overlay
 *
 * Renders interactive prompts for all 5 types via sub-components:
 *   confirm, text, select, multiSelect, number
 *
 * When multiple prompts are pending, a prev/next navigation bar appears.
 * Input state is persisted per-prompt via a useRef Map so switching
 * between questions does not lose entered data.
 *
 * Reads state from getAppState()[1] which contains:
 *   { type: "requestUserInput", pendingUserInputs, respondUserInput }
 */

import { useState, useRef, useCallback, type ReactElement } from "react";
import type { UserInputPromptState, PromptInputState } from "./types";
import {
  ConfirmPrompt,
  TextPrompt,
  SelectPrompt,
  MultiSelectPrompt,
  NumberPrompt,
} from "./prompts";
import type { PromptComponentProps } from "./prompts";
import styles from "./UserInputPrompt.module.scss";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  readonly state: UserInputPromptState | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_INPUT_STATE: PromptInputState = {
  textValue: "",
  selectedOptions: new Set<string>(),
};

// ── Component ─────────────────────────────────────────────────────────────────

export function UserInputPrompt({ state }: Props): ReactElement | null {
  if (!state || !state.pendingUserInputs || state.pendingUserInputs.length === 0) {
    return null;
  }

  const prompts = state.pendingUserInputs;
  const [currentIndex, setCurrentIndex] = useState(0);

  // Persist input state per prompt id across navigation.
  const inputStates = useRef<Map<string, PromptInputState>>(new Map());

  const getInputState = useCallback(
    (promptId: string): PromptInputState => {
      const existing = inputStates.current.get(promptId);
      if (existing) return existing;

      // Initialize from prompt defaults.
      const prompt = prompts.find((p) => p.id === promptId);
      const initial: PromptInputState = {
        textValue: prompt?.defaultValue ?? "",
        selectedOptions: new Set(),
      };
      inputStates.current.set(promptId, initial);
      return initial;
    },
    [prompts],
  );

  const setInputState = useCallback(
    (promptId: string, s: PromptInputState) => {
      inputStates.current.set(promptId, s);
    },
    [],
  );

  // Remove a prompt from the list and adjust index.
  const cancelCurrent = useCallback(() => {
    if (prompts.length === 0) return;
    const prompt = prompts[currentIndex];
    if (!prompt) return;
    state.respondUserInput(prompt.id, null);

    // Adjust index: if last item removed, go back one.
    const newTotal = prompts.length - 1;
    if (currentIndex >= newTotal && newTotal > 0) {
      setCurrentIndex(newTotal - 1);
    }
  }, [prompts, currentIndex, state]);

  // Respond to current prompt and auto-advance.
  const handleRespond = useCallback(
    (value: string | null) => {
      const prompt = prompts[currentIndex];
      if (!prompt) return;
      state.respondUserInput(prompt.id, value);

      // After responding, jump to next (or stay if last one).
      const newTotal = prompts.length - 1;
      if (currentIndex >= newTotal) {
        // Last prompt answered; on next render it'll be removed.
        if (newTotal > 0) setCurrentIndex(newTotal - 1);
      }
      // Don't auto-advance — React will re-render with updated prompts array.
    },
    [prompts, currentIndex, state],
  );

  // Guard: if currentIndex is out of bounds after prompt removal.
  const safeIndex = Math.min(currentIndex, prompts.length - 1);
  if (safeIndex !== currentIndex) {
    setCurrentIndex(safeIndex);
    return null; // Will re-render with corrected index.
  }

  const currentPrompt = prompts[currentIndex];
  const total = prompts.length;

  const onInputStateChange = (s: PromptInputState) => {
    setInputState(currentPrompt.id, s);
  };

  const promptProps: PromptComponentProps = {
    prompt: currentPrompt,
    onRespond: handleRespond,
    inputState: getInputState(currentPrompt.id),
    onInputStateChange,
  };

  return (
    <div className={styles.prompt}>
      {/* ── Navigation bar (only when multiple prompts) ── */}
      {total > 1 && (
        <>
          <div className={styles.promptNav}>
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              className={styles.promptNavBtn}
              aria-label="Previous question"
            >
              ◀
            </button>
            <span className={styles.promptNavLabel}>
              Question {currentIndex + 1} / {total}
            </span>
            <button
              type="button"
              disabled={currentIndex === total - 1}
              onClick={() =>
                setCurrentIndex((i) => Math.min(total - 1, i + 1))
              }
              className={styles.promptNavBtn}
              aria-label="Next question"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={cancelCurrent}
              className={styles.promptNavCancel}
              title="Cancel this question"
            >
              ×
            </button>
          </div>
          {/* Dots indicator */}
          <div className={styles.promptDots}>
            {prompts.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentIndex(i)}
                aria-label={`Go to question ${i + 1}`}
                className={`${styles.promptDot} ${i === currentIndex ? styles.promptDotActive : ""}`}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Prompt body (scrollable) ── */}
      <div className={styles.promptBody}>
        {/* Single prompt: still show cancel button */}
        {total === 1 && (
          <div className={styles.promptNav}>
            <span className={styles.promptNavLabel}>Question</span>
            <button
              type="button"
              onClick={cancelCurrent}
              className={styles.promptNavCancel}
              title="Cancel this question"
            >
              ×
            </button>
          </div>
        )}

        {/* Dispatch to sub-component based on prompt kind */}
        <PromptContent {...promptProps} />
      </div>
    </div>
  );
}

// ── PromptContent (type dispatcher) ───────────────────────────────────────────

function PromptContent(props: PromptComponentProps): ReactElement {
  switch (props.prompt.kind) {
    case "confirm":
      return <ConfirmPrompt {...props} />;
    case "text":
      return <TextPrompt {...props} />;
    case "select":
      return <SelectPrompt {...props} />;
    case "multiSelect":
      return <MultiSelectPrompt {...props} />;
    case "number":
      return <NumberPrompt {...props} />;
  }
}

