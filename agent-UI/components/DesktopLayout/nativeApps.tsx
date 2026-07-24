/**
 * components/DesktopLayout/nativeApps.tsx — Native desktop app registry
 *
 * SINGLE SOURCE OF TRUTH for all built-in (non-slot) desktop apps.
 * Each entry provides an `AppWindowEntry` (title bar, icon, position)
 * and a `renderContent` function (the body rendered inside the window).
 *
 * Adding a new native app: just push another entry to NATIVE_APPS.
 * DesktopPane, IconsGrid, and Taskbar handle it automatically.
 */

import type { ReactElement } from "react";
import type { AppSlotDeclaration } from "@agent-type";
import { PluginManagerPanel } from "../../pluginManager/PluginManagerPanel";
import type { AppWindowEntry } from "./windowManager";

// ── Virtual plugin id for all native apps ───────────────────────────────────
// Distinguishes native entries from slot-based plugin apps in AppWindow.

export const NATIVE_PLUGIN_ID = "__native__" as const;

// ── Native app definition ───────────────────────────────────────────────────

export interface NativeAppDefinition {
  /** Unique slot id (prefix "native:" to avoid collisions). */
  readonly slotId: string;
  /** Declaration matching AppSlotDeclaration shape. */
  readonly declaration: AppSlotDeclaration;
  /** React component rendered as the window body. */
  renderContent(onClose: () => void): ReactElement;
}

// ── Registry ─────────────────────────────────────────────────────────────────

/**
 * All native desktop apps.  Push a new entry here to add a built-in app.
 * The app automatically appears in IconsGrid, Taskbar, and the window manager.
 */
export const NATIVE_APPS: readonly NativeAppDefinition[] = [
  {
    slotId: "native:plugin-manager",
    declaration: {
      type: "app",
      icon: "🧩",
      label: "Plugin Manager",
      defaultWidth: 720,
      defaultHeight: 540,
      resizable: true,
      minimizable: true,
    },
    renderContent(onClose) {
      return <PluginManagerPanel onClose={onClose} />;
    },
  },
];

// ── Converters ───────────────────────────────────────────────────────────────

/** Build an AppWindowEntry from a native app definition. */
export function nativeAppToEntry(def: NativeAppDefinition): AppWindowEntry {
  return {
    pluginId: NATIVE_PLUGIN_ID,
    slotId: def.slotId,
    declaration: def.declaration,
    toolSetSymbol: Symbol.for(def.slotId),
  };
}
