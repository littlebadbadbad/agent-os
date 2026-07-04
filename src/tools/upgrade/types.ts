// Imported as a side-effect by toolSet.ts to register module augmentations.
// Must be a module (has `export {}`) so `declare module` blocks are treated
// as augmentations rather than ambient declarations.
export {};

import type { VersionInfo } from './adapter';

declare module '@agent-type' {
  interface SessionEntryExtension {
    /**
     * Set to `true` immediately before an upgrade restart is triggered.
     * Cleared by UpgradeToolSet on the next session load so the fallback
     * "continue session?" prompt can be surfaced via `onSessionReady`.
     *
     * Only used when `UserInputToolSet` is not installed.  When it IS
     * installed, the non-ephemeral pending input created by `upgrade_restart`
     * is persisted directly in `pendingUserInputs` and the ghost-restore
     * mechanism handles continuation automatically.
     */
    upgradeRestartPending?: true;
  }
}

declare module '@agent-type' {
  interface AgentSessionExtension {
    /** Live version info surfaced to the UI. `undefined` until fetched. */
    upgradeInfo?: VersionInfo;
    /** Dev server URL while the dev server is running. */
    upgradeDevUrl?: string;
    /** Whether the dev server is currently running. */
    upgradeDevRunning?: boolean;
    /** Terminal ID of the running dev server terminal, if any. */
    upgradeDevTerminalId?: string;
    /** Whether upgrade_complete was called this turn (reset on next onBeforeRun). */
    upgradeFrozen?: boolean;
  }
}
