// ── Side-effect: register SessionEntry and AgentSession module augmentations ──
import './types';

import { toolSetContextKey } from '@agent-sdk/tools/toolSet';
import type { ToolSet, ToolSetContext } from '@agent-type';
import type { Tool } from '@agent-type';
import type { SessionEntryData } from '@agent-sdk/client/sessionManager.types';
import type { AgentMessage } from '@agent-type';
import type { UpgradeAdapter } from './adapter';
import { upgradeStore } from './store';
import { createUpgradeTools } from './tools';

// ── Public types ──────────────────────────────────────────────────────────────

export type UpgradeOptions = {
  /** Adapter used by `upgrade_get_version` and `upgrade_restart` tools. */
  adapter: UpgradeAdapter;
};

// ── Workflow guidance (injected into every system prompt) ─────────────────────

const WORKFLOW_GUIDANCE = `\
## Self-Upgrade Discipline

Every change you ship goes through the same loop — no exceptions.

### 1. Develop
Use file, terminal, and browser tools to make and inspect changes.
Build/test/restart: always try upgrade_* tools first — 先试工具集，不行再手动。

### 2. Verify — mandatory, use every available means
Don't pick one method and call it done. Use all that are relevant:
- **Type safety first**: upgrade_run_tests(target=typecheck) — run tsc --noEmit BEFORE any unit tests. Every type error MUST be fixed before proceeding. No any cop-outs, no unknown evasion — use the most precise, standard, and elegant TypeScript types.
- upgrade_run_tests (target=backend or sdk) — unit tests, pass --coverage and any vitest filter args
- terminal tools — start the dev server, watch logs, reproduce the bug
- browser tools — browser_launch + browser_navigate to the dev URL, inspect visually
If you changed it, you verify it. No exceptions.

### 3. Deliver — one atomic sequence, no going back mid-way
git_stage → upgrade_build → upgrade_restart → browser_navigate (verify production loads)

### 4. Seal
Call upgrade_complete after confirming the new version is live and correct.
- This turn ends here: no more file edits, builds, or git operations
- Write a concise delivery summary for the user
- These restrictions lift automatically when the user sends their next message`;

const FREEZE_BANNER = `\
## ⛔ DELIVERY SEALED
upgrade_complete was called this turn. Write a summary for the user and end this turn. No file edits, builds, or commits.`;

// ── Factory ───────────────────────────────────────────────────────────────────

export function createUpgradeToolSet(options: UpgradeOptions): ToolSet {
  const { adapter } = options;
  const tools = createUpgradeTools(adapter);

  function key(ctx: ToolSetContext): string {
    return toolSetContextKey(ctx);
  }

  return {
    name: 'upgrade',
    description: 'Server version querying, upgrade management, dev server, and test runner',
    coreTools: ['upgrade_get_version'],
    tools,

    // ── Session lifecycle ─────────────────────────────────────────────────────

    onInitSession(ctx: ToolSetContext, entryData: SessionEntryData): void {
      // Restore the fallback-path restart-pending flag from the persisted snapshot.
      if (entryData.upgradeRestartPending) {
        upgradeStore.setRestartPending(key(ctx), true);
      }
      // Best-effort async version fetch to populate UI state.
      adapter
        .getVersion()
        .then((info) => upgradeStore.setVersion(key(ctx), info))
        .catch(() => { /* non-fatal */ });
    },

    onSessionReady(ctx: ToolSetContext, sendMessage: (text: string) => void): void {
      // Fallback path: UserInputToolSet not installed — the restart-pending flag
      // was saved in the snapshot.  Prompt the user via the confirm adapter and
      // inject a new user message if they want to continue.
      const bucket = upgradeStore.get(key(ctx));
      if (!bucket?.restartPending) return;

      upgradeStore.setRestartPending(key(ctx), false);

      adapter.confirm(
        'The server was restarted for an upgrade. ' +
        'Your session was interrupted — would you like to continue from where you left off?',
      )
        .then((yes) => {
          if (yes) {
            sendMessage(
              'Upgrade complete. Please continue from where you left off before the restart.',
            );
          }
        })
        .catch(() => { /* ignore */ });
    },

    onBeforeRun(ctx: ToolSetContext, _history: readonly AgentMessage[]): void {
      // Reset the frozen flag at the start of every user turn so
      // upgrade_complete only blocks for the remainder of the turn it was called.
      upgradeStore.setFrozen(key(ctx), false);
    },

    onResetSession(ctx: ToolSetContext): void {
      upgradeStore.setRestartPending(key(ctx), false);
    },

    onRemoveSession(ctx: ToolSetContext): void {
      upgradeStore.remove(key(ctx));
    },

    // ── State ─────────────────────────────────────────────────────────────────

    onGetState(ctx: ToolSetContext) {
      const bucket = upgradeStore.get(key(ctx));
      return {
        upgradeInfo: bucket?.version,
        upgradeDevUrl: bucket?.devUrl,
        upgradeDevRunning: bucket?.devRunning,
        upgradeDevTerminalId: bucket?.devTerminalId,
        upgradeFrozen: bucket?.frozen,
      };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return upgradeStore.subscribe(key(ctx), fn);
    },

    // ── Persistence ───────────────────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext) {
      const bucket = upgradeStore.get(key(ctx));
      if (bucket?.restartPending) {
        return { upgradeRestartPending: true as const };
      }
      return {};
    },

    // ── Tool filtering ────────────────────────────────────────────────────────

    onFilterTools(ctx: ToolSetContext, allTools: readonly Tool[]): readonly Tool[] {
      const bucket = upgradeStore.get(key(ctx));
      if (!bucket?.frozen) return allTools;
      // When frozen, hide all File Management, Git, and Upgrade tools except
      // upgrade_get_version (so the AI can still report the current version).
      return allTools.filter((t) => {
        if (t.group === 'File Management') return false;
        if (t.group === 'Git') return false;
        if (t.group === 'Upgrade' && t.name !== 'upgrade_get_version') return false;
        return true;
      });
    },

    // ── System prompt ─────────────────────────────────────────────────────────

    onGetSystemPrompt(ctx: ToolSetContext): string {
      const bucket = upgradeStore.get(key(ctx));
      const parts: string[] = [];

      // When frozen, put the banner FIRST so it cannot be missed.
      if (bucket?.frozen) {
        parts.push(FREEZE_BANNER);
      }

      if (bucket?.version) {
        parts.push(`## Current Version\n\nRunning version: \`${bucket.version.version}\``);
      }

      parts.push(WORKFLOW_GUIDANCE);

      return parts.join('\n\n');
    },
  };
}
