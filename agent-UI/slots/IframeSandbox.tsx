/**
 * agent-UI/slots/IframeSandbox.tsx — Generic sandboxed iframe container
 *
 * Renders a sandboxed `<iframe>`, injects the `UiAppHostInternal`
 * reference via `contentWindow.__UAP_APP_HOST__`, and calls
 * `onReady` when the iframe has loaded.
 *
 * Security:
 *   - R5: `sandbox="allow-scripts allow-same-origin allow-forms"`
 *   - Host reference injected via direct same-realm reference (D6)
 *
 * Permissions:
 *   Slot-declared `permissions` (see {@link buildIframePermissions}) are
 *   translated into the sandbox tokens, `allow` attribute and boolean
 *   attributes (e.g. `allow-pointer-lock`, `allowfullscreen`) so content
 *   loaded in the iframe behaves like a real browser tab.
 *
 * Communication:
 *   The host is injected as a direct same-realm object reference.
 *   Host→iframe communication flows through `_pushToIframe` / `onSlotMessage`.
 *   No raw `postMessage` or `addEventListener('message')` is used.
 */

import { useEffect, useRef, useCallback, type ReactElement } from "react";
import type {
  UiAppHostInternal,
} from "@agent-type";
import { injectIframeCssVars } from "@agent-UI/styles/cssVariables";
import {
  DEFAULT_IFRAME_PERMISSIONS,
  buildIframePermissions,
} from "./iframePermissions";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface IframeSandboxProps {
  /** DOM id for the wrapper div. */
  readonly id?: string;
  /** CSS class for the wrapper div. */
  readonly className?: string;
  /** The app's UI entry URL. */
  readonly uiEntryUrl: string;
  /** The UiAppHostInternal to inject into the iframe. */
  readonly host: UiAppHostInternal;
  /** Called when the iframe is loaded and the host is injected. */
  readonly onReady: (iframe: HTMLIFrameElement) => void;
  /** Called when the iframe fails to load or create. */
  readonly onError?: (error: Error) => void;
  /** Additional sandbox flags. */
  readonly sandboxFlags?: readonly string[];
  /**
   * Permissions Policy features granted to this iframe
   * (e.g. `["pointer-lock", "fullscreen"]`).
   *
   * Translated into sandbox tokens, the `allow` attribute and dedicated
   * boolean attributes (e.g. `allowfullscreen`) via
   * {@link buildIframePermissions}.  Defaults to
   * `DEFAULT_IFRAME_PERMISSIONS`; pass `[]` to opt out.
   */
  readonly permissions?: readonly string[];
  /**
   * Sizing mode:
   *   - `"fill"` (default): wrapper + iframe stretch to 100% × 100%.
   *     Use for panels and full-viewport slots.
   *   - `"fit"`: wrapper is `inline-block`; iframe dimensions are set
   *     via `containingWidth` + `containingHeight`.  Use for inline
   *     slots like header bars that should blend into the layout flow.
   */
  readonly sizing?: "fill" | "fit";
  /**
   * When `sizing === "fit"`, sets the container/iframe width (CSS string).
   * Sourced from the slot declaration's `containingWidth`.
   * Ignored when `sizing === "fill"`.
   */
  readonly containingWidth?: string;
  /**
   * When `sizing === "fit"`, sets the container/iframe height (CSS string).
   * Sourced from the slot declaration's `containingHeight`.
   * Ignored when `sizing === "fill"`.
   */
  readonly containingHeight?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IframeSandbox(
  props: IframeSandboxProps,
): ReactElement {
  const {
    id,
    className,
    uiEntryUrl,
    host,
    onReady,
    onError,
    sandboxFlags,
    permissions = DEFAULT_IFRAME_PERMISSIONS,
    sizing = "fill",
    containingWidth,
    containingHeight,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const destroyedRef = useRef(false);

  const cw = containingWidth ?? "auto";
  const ch = containingHeight ?? "auto";

  // Fill mode: if the app declares containing dimensions, use them.
  // Otherwise default to 100% × 100% (parent sets size via className).
  const fillWidth = containingWidth ?? "100%";
  const fillHeight = containingHeight ?? "100%";

  const createSandbox = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // R1: error isolation.
    try {
      const iframe = document.createElement("iframe");

      // R5: sandbox — base flags plus any tokens required by the granted
      // permissions (e.g. `allow-pointer-lock`).
      const flags = sandboxFlags ?? ["allow-scripts", "allow-same-origin", "allow-forms"];
      for (const flag of flags) {
        iframe.sandbox.add(flag);
      }

      // Slot-declared permissions → `allow` attribute + boolean attributes.
      // Without these the embedded document is denied pointer lock and
      // fullscreen (the Permissions Policy default allowlist is `self`).
      const permissionParts = buildIframePermissions(permissions);
      for (const token of permissionParts.sandboxTokens) {
        iframe.sandbox.add(token);
      }
      if (permissionParts.allowPolicy) {
        iframe.allow = permissionParts.allowPolicy;
      }
      for (const attribute of permissionParts.attributes) {
        iframe.setAttribute(attribute, "");
      }

      iframe.style.width = sizing === "fit" ? cw : "100%";
      iframe.style.height = sizing === "fit" ? ch : "100%";
      iframe.style.border = "none";
      if (sizing === "fit") {
        iframe.style.display = "inline-block";
        iframe.style.verticalAlign = "middle";
        iframe.style.overflow = "hidden";
        // Prevent fit-mode iframes from growing beyond their containing height.
        if (ch !== "auto") {
          iframe.style.maxHeight = ch;
        }
      }
      iframe.setAttribute("aria-label", `App slot iframe`);

      // D6: inject host when iframe loads.
      iframe.addEventListener("load", () => {
        if (destroyedRef.current) return;
        try {
          const win = iframe.contentWindow as (Window & { __UAP_APP_HOST__?: UiAppHostInternal }) | null;
          if (win) {
            win.__UAP_APP_HOST__ = host;
          }

          // Inject the canonical CSS custom properties into the iframe's
          // document root.  CSS custom properties do NOT cross iframe
          // boundaries — without this every `var(--sp-3)` inside the app
          // would resolve to `undefined`.
          injectIframeCssVars(iframe);

          iframeRef.current = iframe;
          onReady(iframe);
        } catch (err) {
          console.warn("[IframeSandbox] Failed to inject host:", err);
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      });

      iframe.src = uiEntryUrl;
      container.appendChild(iframe);
    } catch (err) {
      console.warn("[IframeSandbox] Failed to create iframe:", err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [uiEntryUrl, host, onReady, onError, sandboxFlags, permissions, cw, ch, sizing]);

  useEffect(() => {
    destroyedRef.current = false;
    createSandbox();

    return () => {
      destroyedRef.current = true;
      if (iframeRef.current) {
        iframeRef.current.remove();
        iframeRef.current = null;
      }
    };
  }, [uiEntryUrl, permissions]);

  return (
    <div
      ref={containerRef}
      id={id}
      className={className}
      style={sizing === "fit"
        ? { display: "inline-block", width: cw, height: ch, verticalAlign: "middle", overflow: "hidden" }
        : { width: fillWidth, height: fillHeight }
      }
    />
  );
}
