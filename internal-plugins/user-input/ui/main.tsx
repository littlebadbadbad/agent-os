/**
 * internal-plugins/user-input/ui/main.tsx — User Input plugin UI entry (iframe)
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
  ToolCallInfo,
} from "@agent-type";
import { UserInputPrompt } from "./UserInputPrompt";
import { PendingInputStrip } from "./PendingInputStrip";
import { AskUserCard } from "./AskUserCard";
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
  const slotCtx = host.getSlotContext();

  // ── Reactive store ────────────────────────────────────────────────────────

  let toolSetState: UserInputPluginState | null = null;
  let toolCallInfo: ToolCallInfo | null = null;
  const listeners = new Set<() => void>();

  const readState = () => {
    const state = host.getPluginState();
    toolSetState = state?.[1] ?? null;
  };

  readState();

  const emitChange = () => {
    readState();
    listeners.forEach((l) => l());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };
  const getToolCallSnapshot = () => toolCallInfo;
  const getStateSnapshot = () => toolSetState;

  // ── Host→iframe messages ──────────────────────────────────────────────────

  host.onSlotMessage((msg: SlotHostMessage) => {
    if (msg.type === 'toolCard') {
      toolCallInfo = msg.payload.toolCallInfo ?? null;
      listeners.forEach((l) => l());
    } else {
      emitChange();
    }
  });

  // ── App component ──────────────────────────────────────────────────────────

  function UserInputPluginApp() {
    // toolCard slot: render AskUserCard
    if (slotCtx.slotType === 'toolCard') {
      const info = useSyncExternalStore(subscribe, getToolCallSnapshot);
      if (!info) {
        return (
          <div style={{ padding: 16, color: '#858585', fontFamily: 'system-ui' }}>
            Waiting for tool call info...
          </div>
        );
      }
      return <AskUserCard info={info} />;
    }

    // panel / inlinePrompt slots: original rendering
    const _ = useSyncExternalStore(subscribe, getStateSnapshot);

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
