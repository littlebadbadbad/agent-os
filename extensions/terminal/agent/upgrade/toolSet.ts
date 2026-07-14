/**
 * extensions/terminal/agent/upgrade/toolSet.ts — Upgrade ToolSet factory
 *
 * Registers 7 self-upgrade tools and manages the upgrade lifecycle:
 * version tracking, build/dev/test workflows, restart persistence,
 * and delivery-seal (freeze) mechanism.
 *
 * Uses symbol-isolated state via onGetSymbolState.
 * Confirm flows exclusively via context.requestUserInput.
 * Terminal polling via co-located terminal plugin adapter.
 */

import "./types"; // module augmentations

import { ctxKey } from "@agent-type";
import type {
  ToolSet,
  ToolSetContext,
  AgentMessage,
  Tool,
  SessionEntryData,
  PluginSlotDeclaration,
  CompactToolCardDescriptor,
  ToolCallInfo,
} from "@agent-type";
import type { UpgradePluginAdapter, VersionInfo } from "./types";
import { upgradeStore } from "./store";
import { createUpgradeTools, type CreateUpgradeToolsOptions } from "./tools";
import { WORKFLOW_GUIDANCE, FREEZE_BANNER } from "./prompt";

// ── Symbol ────────────────────────────────────────────────────────────────

export const UPGRADE_SYMBOL = Symbol("upgrade");

// ── Compact tool-card descriptor helpers ──────────────────────────────────────

function upgradeDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const summary = info.status === "running" ? `${info.name}…` : info.name;
  return { icon: "🔄", label: "Upgrade", summary, status: info.status };
}

// ── Options ────────────────────────────────────────────────────────────────

export interface UpgradeToolSetOptions {
  readonly adapter: UpgradePluginAdapter;
  /**
   * Subset of the co-located terminal adapter needed for terminal polling in
   * build/dev/test tools.
   */
  readonly terminal: CreateUpgradeToolsOptions["terminal"];
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createUpgradeToolSet(options: UpgradeToolSetOptions): ToolSet {
  const { adapter, terminal } = options;
  const tools = createUpgradeTools({ adapter, terminal });

  function key(ctx: ToolSetContext): string {
    return ctxKey(ctx);
  }

  return {
    symbol: UPGRADE_SYMBOL,
    name: "upgrade",
    description:
      "Server version querying, upgrade management, dev server, and test runner",
    coreTools: ["upgrade_get_version"],
    tools,

    // ── Session lifecycle ──────────────────────────────────────────────

    onInitSession(ctx: ToolSetContext, entryData: SessionEntryData): void {
      if (entryData.upgradeRestartPending) {
        upgradeStore.setRestartPending(key(ctx), true);
      }
      adapter
        .getVersion()
        .then((info: VersionInfo) => upgradeStore.setVersion(key(ctx), info))
        .catch(() => {
          /* non-fatal */
        });
    },

    onSessionReady(
      ctx: ToolSetContext,
      sendMessage: (text: string) => void,
    ): void {
      const bucket = upgradeStore.get(key(ctx));
      if (!bucket?.restartPending) return;

      upgradeStore.setRestartPending(key(ctx), false);
      // In plugin model, user-input is always installed — no fallback needed.
      // The persisted post-restart prompt is handled by ghost-restore.
      sendMessage(
        "Upgrade complete. Please continue from where you left off before the restart.",
      );
    },

    onBeforeRun(
      ctx: ToolSetContext,
      _history: readonly AgentMessage[],
    ): void {
      upgradeStore.setFrozen(key(ctx), false);
    },

    onResetSession(ctx: ToolSetContext): void {
      upgradeStore.setRestartPending(key(ctx), false);
    },

    onRemoveSession(ctx: ToolSetContext): void {
      upgradeStore.remove(key(ctx));
    },

    // ── Symbol-isolated state ───────────────────────────────────────────

    onGetSymbolState(ctx: ToolSetContext) {
      const bucket = upgradeStore.get(key(ctx));
      return {
        type: "upgrade" as const,
        upgradeInfo: bucket?.version,
        upgradeDevUrl: bucket?.devUrl,
        upgradeDevRunning: bucket?.devRunning,
        upgradeDevTerminalId: bucket?.devTerminalId,
        upgradeFrozen: bucket?.frozen,
        slots: [
          {
            type: "compactToolCard" as const,
            toolNames: tools.map((t) => t.name),
            getDescriptor: upgradeDescriptor,
          },
        ] satisfies readonly PluginSlotDeclaration[],
      };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return upgradeStore.subscribe(key(ctx), fn);
    },

    // ── Persistence ─────────────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext) {
      const bucket = upgradeStore.get(key(ctx));
      if (bucket?.restartPending) {
        return { upgradeRestartPending: true as const };
      }
      return {};
    },

    // ── Tool filtering ──────────────────────────────────────────────────

    onFilterTools(
      ctx: ToolSetContext,
      allTools: readonly Tool[],
    ): readonly Tool[] {
      const bucket = upgradeStore.get(key(ctx));
      if (!bucket?.frozen) return allTools;
      return allTools.filter((t) => {
        if (t.group === "File Management") return false;
        if (t.group === "Git") return false;
        if (t.group === "Upgrade" && t.name !== "upgrade_get_version")
          return false;
        return true;
      });
    },

    // ── System prompt ───────────────────────────────────────────────────

    onGetSystemPrompt(ctx: ToolSetContext): string {
      const bucket = upgradeStore.get(key(ctx));
      const parts: string[] = [];

      if (bucket?.frozen) {
        parts.push(FREEZE_BANNER);
      }

      if (bucket?.version) {
        parts.push(
          `## Current Version\n\nRunning version: \`${bucket.version.version}\``,
        );
      }

      parts.push(WORKFLOW_GUIDANCE);

      return parts.join("\n\n");
    },
  };
}
