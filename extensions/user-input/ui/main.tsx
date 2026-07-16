/**
 * extensions/user-input/ui/main.tsx — User Input plugin UI entry (iframe)
 *
 * Per-toolset slot isolation:
 *   - Each ToolSet owns its slot → independent iframe
 *   - getPluginState() returns [SessionStateLike, toolSetState] (2-tuple)
 *   - `type` discriminant on toolSetState determines which component to render
 *
 * Communication contract:
 *   Plugin UI code MUST NOT use `window.parent.postMessage()` or
 *   `window.addEventListener("message")` directly.
 */

import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiPluginHost,
  SlotHostMessage,
  PluginStateExtension,
} from "@agent-type";
import { UserInputPrompt } from "./UserInputPrompt";
import { PendingInputStrip } from "./PendingInputStrip";
import type {
  UserInputPromptState,
  PendingInputStripState,
  UserInputPluginState,
} from "./types";
import { isUserInputPromptState, isPendingInputStripState } from "./types";
import styles from "./main.module.scss";

// ── Type-safe host boundary ───────────────────────────────────────────────────
// window.__UAP_PLUGIN_HOST__ is injected by the host as `UiPluginHostInternal`.
// This is the ONLY `as` cast in the entire plugin — the injection boundary
// is inherently untyped; we narrow to our plugin's state union here.

type Host = UiPluginHost<UserInputPluginState>;

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: Host;
  }
}

function waitForHost(timeout = 10000): Promise<Host> {
  return new Promise((resolve, reject) => {
    if (window.__UAP_PLUGIN_HOST__) {
      resolve(window.__UAP_PLUGIN_HOST__);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.__UAP_PLUGIN_HOST__) {
        clearInterval(interval);
        resolve(window.__UAP_PLUGIN_HOST__);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for __UAP_PLUGIN_HOST__"));
      }
    }, 50);
  });
}

waitForHost()
  .then((host) => {
    bootApp(host);
  })
  .catch((err) => {
    console.error("[user-input-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        `<div class="${styles.error}">` +
        "User Input plugin UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: Host): void {
  // ── Reactive store ────────────────────────────────────────────────────────

  let toolSetState: UserInputPluginState | null = null;
  const listeners = new Set<() => void>();

  const readState = () => {
    const state = host.getPluginState();
    // state is [SessionStateLike, UserInputPluginState & PluginUiAdapter]
    toolSetState = state?.[1] ?? null;
  };

  readState();

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };

  const emitChange = () => {
    readState();
    listeners.forEach((l) => l());
  };

  // ── Host→iframe messages ──────────────────────────────────────────────────

  host.onSlotMessage((_msg: SlotHostMessage) => {
    emitChange();
  });

  // ── App component ──────────────────────────────────────────────────────────

  function UserInputPluginApp() {
    const _ = useSyncExternalStore(subscribe, () => toolSetState);

    if (!toolSetState) return null;

    if (isUserInputPromptState(toolSetState)) {
      return (
        <div className={styles.wrapper}>
          <UserInputPrompt state={toolSetState} />
        </div>
      );
    }

    if (isPendingInputStripState(toolSetState)) {
      return (
        <div className={styles.wrapper}>
          <PendingInputStrip state={toolSetState} />
        </div>
      );
    }

    return null;
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  const rootEl = document.getElementById("root");
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <UserInputPluginApp />
      </StrictMode>,
    );
  }
}
