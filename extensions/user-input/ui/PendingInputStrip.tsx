/**
 * extensions/user-input/ui/PendingInputStrip.tsx — Queued message ghost bubbles
 *
 * Renders pending (queued) messages as ghost bubbles with:
 *   - Cancel button per entry
 *   - "Continue All" button when agent is idle and queue is non-empty
 *
 * Reads state from getPluginState()[2] which contains:
 *   { type: "pendingInput", pendingInputMessages, cancelQueuedInput, resumeQueuedInputs }
 */

import type { ReactElement } from "react";
import type { PendingInputStripState } from "./types";
import styles from "./PendingInputStrip.module.scss";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  readonly state: PendingInputStripState | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PendingInputStrip({ state }: Props): ReactElement | null {
  if (!state || !state.pendingInputMessages || state.pendingInputMessages.length === 0) {
    return null;
  }

  const hasBorder = state.pendingInputMessages.length > 0;
  const containerClass = `${styles.strip} ${hasBorder ? styles.stripHasBorder : ""}`;

  return (
    <div className={containerClass}>
      {state.pendingInputMessages.map((entry) => (
        <div key={entry.id} className={styles.entry}>
          <span className={styles.entryIcon}>⏳</span>
          <span className={styles.entryText}>{entry.text}</span>
          {state.cancelQueuedInput && (
            <button
              type="button"
              onClick={() => state.cancelQueuedInput!(entry.id)}
              title="Remove this message"
              className={styles.cancelBtn}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {state.resumeQueuedInputs && (
        <button
          type="button"
          onClick={() => state.resumeQueuedInputs!()}
          className={styles.continueBtn}
        >
          Continue All ({state.pendingInputCount})
        </button>
      )}
    </div>
  );
}

