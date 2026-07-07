/**
 * extensions/user-input/ui/main.tsx — User Input plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - state[0] → AgentSessionState (base, always first — provided by host)
 *   - state[1] → UserInputPromptState (first registered toolset)
 *   - state[2] → PendingInputStripState (second registered toolset)
 *   - Receives host→iframe messages via `host.onSlotMessage()`.
 *   - Sends iframe→host messages via `host.sendSlotMessage()`.
 *
 * Communication contract:
 *   Plugin UI code MUST NOT use `window.parent.postMessage()` or
 *   `window.addEventListener("message")` directly.
 *
 * Pattern: same as extensions/browser/ui/main.tsx
 */

import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiPluginHost,
  SlotHostMessage,
  AgentSessionState,
} from "@agent-type";
import { UserInputPrompt } from "./UserInputPrompt";
import { PendingInputStrip } from "./PendingInputStrip";
import type { UserInputPromptState, PendingInputStripState } from "./types";
import {
  isAgentSessionState,
  isUserInputPromptState,
  isPendingInputStripState,
} from "./types";
import styles from "./main.module.scss";

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: UiPluginHost;
  }
}

function waitForHost(timeout = 10000): Promise<UiPluginHost> {
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

function bootApp(host: UiPluginHost): void {

  // ── Reactive store ────────────────────────────────────────────────────────

  let sessionState: AgentSessionState | null = null;
  let userInputState: UserInputPromptState | null = null;
  let pendingInputState: PendingInputStripState | null = null;
  const listeners = new Set<() => void>();

  const readState = () => {
    const state = host.getPluginState();
    if (!state) return;

    // Fixed indices: [0] = session base, [1] = first toolset, [2] = second toolset
    // Type guards verify via `type` discriminant injected by each toolset.
    sessionState = isAgentSessionState(state[0]) ? state[0] : null;
    userInputState = isUserInputPromptState(state[1]) ? state[1] : null;
    pendingInputState = isPendingInputStripState(state[2]) ? state[2] : null;
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

  host.onSlotMessage((msg: SlotHostMessage) => {
    if (msg.type === "inlinePrompt") {
      emitChange();
    }
  });

  // ── App component ──────────────────────────────────────────────────────────

  function UserInputPluginApp() {
    // Re-read from host on every render to stay in sync.
    const _ = useSyncExternalStore(subscribe, () => userInputState);

    const hasPrompts = (userInputState?.pendingUserInputs?.length ?? 0) > 0;
    const hasPending = (pendingInputState?.pendingInputCount ?? 0) > 0;

    if (!hasPrompts && !hasPending) {
      return null;
    }

    return (
      <div className={styles.wrapper}>
        <UserInputPrompt state={userInputState} />
        <PendingInputStrip state={pendingInputState} />
      </div>
    );
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

