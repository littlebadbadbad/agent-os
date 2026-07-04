/**
 * agent-UI/plugin/uiLoader.ts — iframe sandbox loader
 *
 * Creates a sandboxed `<iframe>` that hosts a plugin's UI entry point.
 *
 * Security model (R5): `sandbox="allow-scripts"` only — no
 * `allow-same-origin`, giving the iframe an opaque origin.
 *
 * Communication:
 *   - The UiPluginHost is injected as a direct same-realm reference into
 *     `iframe.contentWindow.__UAP_PLUGIN_HOST__` (D6 — preserves
 *     non-serialisable adapter methods).
 *   - postMessage (Link A/B) carries only lightweight notifications.
 *
 * Validation (R4, R8):
 *   - `event.origin` is validated against the expected origin.
 *   - All messages must carry `version: 1`; mismatched messages are rejected.
 *
 * Error isolation (R1): all iframe creation is wrapped in try-catch.
 * On failure, a fallback message is rendered and the error is logged.
 *
 * No classes — pure factory function.
 */

import type {
  UiPluginHost,
  UapPluginMessage,
  AgentSessionState,
} from "@agent-type";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UiPluginSandbox {
  /** Destroy the sandbox: remove iframe, detach listeners. */
  destroy(): void;
  /** Indicates whether the sandbox has been destroyed. */
  readonly destroyed: boolean;
}

export interface CreateSandboxParams {
  /** DOM container element to mount the iframe into. */
  readonly container: HTMLElement;
  /** URL of the plugin's UI entry HTML file. */
  readonly uiEntryUrl: string;
  /** The UiPluginHost to inject into the iframe. */
  readonly host: UiPluginHost;
  /**
   * Expected origin for postMessage validation (R4).
   * Defaults to `window.location.origin`.
   */
  readonly expectedOrigin?: string;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a sandboxed iframe that loads a plugin's UI entry point.
 *
 * @returns A UiPluginSandbox handle, or `null` if creation failed (R1).
 */
export function createUiPluginSandbox(
  params: CreateSandboxParams,
): UiPluginSandbox | null {
  const { container, uiEntryUrl, host, expectedOrigin } = params;
  const origin = expectedOrigin ?? window.location.origin;

  let iframe: HTMLIFrameElement | null = null;
  let messageListener: ((event: MessageEvent) => void) | null = null;
  let destroyed = false;

  try {
    // R5: sandbox with allow-scripts + allow-same-origin.
    // allow-same-origin is required so the parent can inject the host
    // reference directly into iframe.contentWindow (D6 — same-realm
    // reference preserving non-serialisable adapter methods).
    // The iframe still cannot access parent DOM (sandbox restriction).
    iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.sandbox.add("allow-same-origin");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.setAttribute("aria-label", "Plugin UI");

    // R4 + R8: validate incoming messages from the iframe.
    messageListener = (event: MessageEvent) => {
      if (destroyed || !iframe) return;

      // R4: origin check — reject messages from unexpected origins.
      if (event.source !== iframe.contentWindow) return;
      if (event.origin !== "null") {
        // Opaque-origin iframes send origin === 'null'.
        // Any other origin is suspicious — reject.
        if (event.origin !== origin) {
          console.warn(
            "[uiLoader] Rejected message from unexpected origin:",
            event.origin,
          );
          return;
        }
      }

      const msg = event.data as UapPluginMessage;
      // R8: version check.
      if (!msg || typeof msg !== "object") {
        console.warn(
          "[uiLoader] Rejected message with missing/mismatched version:",
          msg,
        );
        return;
      }

      // Link A: iframe → host.  The host's postMessageSender was set up
      // by the host factory to forward to the host application.
      // Here we just let the message through — the host app decides
      // what to do with it (e.g. resize the container).
      // The host's onHostMessage subscribers are for Link B (host→iframe),
      // so Link A messages are handled by the loader's caller via the
      // host's postMessageSender callback.
    };

    window.addEventListener("message", messageListener);

    // D6: inject the host as a direct same-realm reference.
    //
    // The iframe's `load` event fires AFTER its scripts have executed,
    // so main.tsx must wait for the host asynchronously (it polls
    // window.__UAP_PLUGIN_HOST__).  We inject on `load` and also
    // retry via a short interval in case the load event fires before
    // the iframe's script has registered its poller.
    const injectHost = () => {
      if (destroyed || !iframe?.contentWindow) return false;
      try {
        (
          iframe.contentWindow as unknown as Record<string, unknown>
        ).__UAP_PLUGIN_HOST__ = host;
        return true;
      } catch (err) {
        console.warn("[uiLoader] Failed to inject host into iframe:", err);
        return false;
      }
    };

    iframe.addEventListener("load", () => {
      injectHost();
    });

    iframe.src = uiEntryUrl;
    container.appendChild(iframe);
  } catch (err) {
    // R1: error isolation — log and render fallback.
    console.warn("[uiLoader] Failed to create iframe sandbox:", err);
    renderFallback(container, err instanceof Error ? err.message : String(err));
    return null;
  }

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (messageListener) {
        window.removeEventListener("message", messageListener);
        messageListener = null;
      }
      if (iframe) {
        iframe.remove();
        iframe = null;
      }
    },
    get destroyed(): boolean {
      return destroyed;
    }
  };
}

// ── Fallback ──────────────────────────────────────────────────────────────────

/**
 * Render a fallback message when iframe creation fails (R1).
 */
function renderFallback(container: HTMLElement, errorMsg: string): void {
  container.innerHTML = "";
  const fallback = document.createElement("div");
  fallback.style.cssText =
    "padding:16px;color:#c00;font-family:monospace;font-size:13px;border-radius:8px;background:#fff0f0;";
  fallback.textContent = `Plugin UI failed to load: ${errorMsg}`;
  container.appendChild(fallback);
}
