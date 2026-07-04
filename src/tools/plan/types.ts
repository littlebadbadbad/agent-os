// ── Module augmentation ───────────────────────────────────────────────────────
// This file must be a proper ES module (has `export {}`) so that `declare module`
// blocks are treated as augmentations, not ambient declarations.
export {};

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Persisted plan markdown content for this session. */
    plan?: string;
    /** Whether the session is in plan mode (design only, no execution). */
    planMode?: boolean;
  }
}

declare module '@agent-type' {
  interface AgentSessionExtension {
    /** Live plan markdown content exposed to the UI. */
    plan?: string;
    /** Whether the session is in plan mode. */
    planMode?: boolean;
  }
}
