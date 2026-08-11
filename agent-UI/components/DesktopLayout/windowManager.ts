/**
 * components/DesktopLayout/windowManager.ts — Pure window state reducer
 *
 * Manages open/minimized app windows with a single atomic reducer.
 * No React dependency — usable from any framework.
 */

import type { AppSlotDeclaration, SlotDeclaration } from "@agent-type";

// ── Entry ─────────────────────────────────────────────────────────────────────

export interface AppWindowEntry {
  readonly appId: string;
  readonly slotId: string;
  readonly declaration: AppSlotDeclaration;
  readonly toolSetSymbol: symbol;
}

// ── State ─────────────────────────────────────────────────────────────────────

export interface WindowManagerState {
  /** Open windows in z-order (last = topmost). */
  readonly windows: readonly AppWindowEntry[];
  /** Currently focused window slotId. */
  readonly focusedSlotId: string | null;
  /** Set of minimized window slotIds. */
  readonly minimizedSlotIds: ReadonlySet<string>;
}

// ── Action ────────────────────────────────────────────────────────────────────

export type WindowAction =
  | { readonly type: "toggle"; readonly entry: AppWindowEntry }
  | { readonly type: "close"; readonly slotId: string }
  | { readonly type: "focus"; readonly slotId: string }
  | { readonly type: "minimize"; readonly slotId: string }
  | { readonly type: "restore"; readonly slotId: string };

// ── Reducer ───────────────────────────────────────────────────────────────────

export function windowReducer(
  state: WindowManagerState,
  action: WindowAction,
): WindowManagerState {
  switch (action.type) {
    case "toggle": {
      const existing = state.windows.find((w) => w.slotId === action.entry.slotId);
      if (!existing) {
        // Open a new window.
        return {
          windows: [...state.windows, action.entry],
          focusedSlotId: action.entry.slotId,
          minimizedSlotIds: new Set(
            [...state.minimizedSlotIds].filter((id) => id !== action.entry.slotId),
          ),
        };
      }
      // Window exists — close if focused, focus if minimized, minimize if open.
      const isMinimized = state.minimizedSlotIds.has(action.entry.slotId);
      if (state.focusedSlotId === action.entry.slotId && !isMinimized) {
        // Focused and not minimized → minimize.
        return {
          ...state,
          minimizedSlotIds: new Set([...state.minimizedSlotIds, action.entry.slotId]),
          focusedSlotId: null,
        };
      }
      // Minimized or not focused → restore and focus.
      return {
        windows: bringToFront(state.windows, action.entry.slotId),
        focusedSlotId: action.entry.slotId,
        minimizedSlotIds: new Set(
          [...state.minimizedSlotIds].filter((id) => id !== action.entry.slotId),
        ),
      };
    }
    case "close": {
      const next = state.windows.filter((w) => w.slotId !== action.slotId);
      return {
        windows: next,
        focusedSlotId:
          state.focusedSlotId === action.slotId
            ? next.length > 0
              ? next[next.length - 1].slotId
              : null
            : state.focusedSlotId,
        minimizedSlotIds: new Set(
          [...state.minimizedSlotIds].filter((id) => id !== action.slotId),
        ),
      };
    }
    case "focus": {
      const idx = state.windows.findIndex((w) => w.slotId === action.slotId);
      if (idx < 0) return state;
      if (idx === state.windows.length - 1 && state.focusedSlotId === action.slotId) {
        return state;
      }
      return {
        windows: bringToFront(state.windows, action.slotId),
        focusedSlotId: action.slotId,
        minimizedSlotIds: new Set(
          [...state.minimizedSlotIds].filter((id) => id !== action.slotId),
        ),
      };
    }
    case "minimize": {
      if (!state.minimizedSlotIds.has(action.slotId)) {
        return {
          ...state,
          minimizedSlotIds: new Set([...state.minimizedSlotIds, action.slotId]),
          focusedSlotId:
            state.focusedSlotId === action.slotId && state.windows.length > 0
              ? state.windows.find((w) => w.slotId !== action.slotId)?.slotId ?? null
              : state.focusedSlotId,
        };
      }
      return state;
    }
    case "restore": {
      if (state.minimizedSlotIds.has(action.slotId)) {
        return {
          ...state,
          minimizedSlotIds: new Set(
            [...state.minimizedSlotIds].filter((id) => id !== action.slotId),
          ),
          focusedSlotId: action.slotId,
        };
      }
      return state;
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createInitialWindowState(): WindowManagerState {
  return {
    windows: [],
    focusedSlotId: null,
    minimizedSlotIds: new Set(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bringToFront(
  windows: readonly AppWindowEntry[],
  slotId: string,
): readonly AppWindowEntry[] {
  const idx = windows.findIndex((w) => w.slotId === slotId);
  if (idx < 0 || idx === windows.length - 1) return windows;
  const reordered = [...windows];
  const [item] = reordered.splice(idx, 1);
  reordered.push(item);
  return reordered;
}
