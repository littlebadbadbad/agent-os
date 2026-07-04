// ── Module augmentation ───────────────────────────────────────────────────────

declare module "@agent-type" {
  interface SessionEntryExtension {
    /** Persisted pending inputs to restore on page reload. */
    pendingInputs?: PendingInputEntry[];
  }

  interface AgentSessionExtension {
    /**
     * Queue a user message to be injected into the agent's next loop iteration.
     * Available on `AgentSessionState` when a `PendingInputToolSet` is registered.
     * The UI calls this during `isLoading=true` instead of `sendMessage()`.
     */
    queueUserInput?: (text: string) => void;

    /** Number of pending user-input messages waiting for the next loop iteration. */
    pendingInputCount?: number;
    /** Pending messages (in order) with their stable IDs for per-item cancellation. */
    pendingInputMessages?: { id: string; text: string }[];
    /** Remove a single queued message by its ID. */
    cancelQueuedInput?: (id: string) => void;
    /** Send the entire pending queue: first entry via sendMessage, remainder injected at turn 0. */
    resumeQueuedInputs?: () => void;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type PendingInputEntry = {
  id: string;
  text: string;
};
