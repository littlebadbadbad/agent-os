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
import { AppManagerPanel } from "../../appManager/AppManagerPanel";
import { NetDebugApp } from "../NetDebug/NetDebugApp";
import type { AppWindowEntry } from "./windowManager";

// ── Virtual app id for all native apps ───────────────────────────────────
// Distinguishes native entries from slot-based app apps in AppWindow.

export const NATIVE_APP_ID = "__native__" as const;

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
const appManagerApp: NativeAppDefinition = {
  slotId: "native:app-manager",
  declaration: {
    type: "app",
    icon: "🧩",
    label: "App Manager",
    defaultWidth: 720,
    defaultHeight: 540,
    resizable: true,
    minimizable: true,
  },
  renderContent(onClose) {
    return <AppManagerPanel onClose={onClose} />;
  },
};

/** Debug network console — installed only in local dev builds. */
const netDebugApp: NativeAppDefinition = {
  slotId: "native:net-debug",
  declaration: {
    type: "app",
    icon: "🛰",
    label: "网络监控",
    defaultWidth: 960,
    defaultHeight: 600,
    resizable: true,
    minimizable: true,
  },
  renderContent(_onClose) {
    return <NetDebugApp />;
  },
};

export const NATIVE_APPS: readonly NativeAppDefinition[] = [
  appManagerApp,
  // Local dev only: the network console ships nowhere else (recording itself
  // stays available in prod bundles via ?debug — see env.ts).
  ...(import.meta.env.DEV ? [netDebugApp] : []),
];

// ── Converters ───────────────────────────────────────────────────────────────

/** Build an AppWindowEntry from a native app definition. */
export function nativeAppToEntry(def: NativeAppDefinition): AppWindowEntry {
  return {
    appId: NATIVE_APP_ID,
    slotId: def.slotId,
    declaration: def.declaration,
    toolSetSymbol: Symbol.for(def.slotId),
  };
}
