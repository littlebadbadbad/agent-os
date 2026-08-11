/**
 * internal-apps/user-input/agent/pendingInput/types.ts — PendingInput types
 *
 * Module augmentations for session persistence ONLY.
 * App state is isolated via `onGetSymbolState` — do NOT pollute `AppStateExtension`.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingInputEntry {
  readonly id: string;
  readonly text: string;
}

// ── Module augmentation ───────────────────────────────────────────────────────

declare module "@agent-type" {
  interface SessionEntryExtension {
    /** Persisted pending inputs to restore on page reload. */
    pendingInputs?: readonly PendingInputEntry[];
  }
}
