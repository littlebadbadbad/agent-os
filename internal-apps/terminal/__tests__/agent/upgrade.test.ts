/**
 * extensions/terminal/__tests__/agent/upgrade.test.ts — Upgrade app tests
 *
 * Tests the upgrade store, tool definitions, and toolset lifecycle hooks
 * using the new app-based architecture (UpgradeAppAdapter + MinimalTerminalAdapter).
 *
 * TODO: Restore full test coverage from the migrated src/__tests__/tools/upgrade.test.ts.
 * The original tests used direct HTTP/IPC adapters; these now need to be
 * rewritten for the AppApiClient-based UpgradeAppAdapter.
 */

import { describe, it, expect, vi } from "vitest";
import { upgradeStore } from "../../agent/upgrade/store";

// ── Helpers ──────────────────────────────────────────────────────────────

const SESSION = "test-session:main:main";

describe("upgradeStore", () => {
  it("returns undefined for nonexistent key", () => {
    expect(upgradeStore.get("nonexistent")).toBeUndefined();
  });

  it("sets and retrieves version", () => {
    upgradeStore.setVersion(SESSION, { version: "1.0.0" });
    expect(upgradeStore.get(SESSION)?.version?.version).toBe("1.0.0");
  });

  it("notifies subscribers on setVersion", () => {
    const listener = vi.fn();
    const unsub = upgradeStore.subscribe(SESSION, listener);
    upgradeStore.setVersion(SESSION, { version: "2.0.0" });
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops notifications", () => {
    const listener = vi.fn();
    const unsub = upgradeStore.subscribe(SESSION, listener);
    unsub();
    upgradeStore.setVersion(SESSION, { version: "3.0.0" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("removes bucket on remove", () => {
    upgradeStore.setVersion(SESSION, { version: "4.0.0" });
    upgradeStore.remove(SESSION);
    expect(upgradeStore.get(SESSION)).toBeUndefined();
  });
});
