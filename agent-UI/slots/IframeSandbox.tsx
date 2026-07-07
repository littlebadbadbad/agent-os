/**
 * agent-UI/slots/IframeSandbox.tsx — Generic sandboxed iframe container
 *
 * Renders a sandboxed `<iframe>`, injects the `UiPluginHostInternal`
 * reference via `contentWindow.__UAP_PLUGIN_HOST__`, and calls
 * `onReady` when the iframe has loaded.
 *
 * Extracted from `agent-UI/plugin/uiLoader.ts` and generalized:
 *   - No longer tied to a specific message protocol.
 *   - React component instead of imperative DOM manipulation.
 *   - Error isolation (R1): renders fallback on failure.
 *
 * Security:
 *   - R5: `sandbox="allow-scripts allow-same-origin"`
 *   - Host reference injected via direct same-realm reference (D6)
 *
 * Communication:
 *   The host is injected as a direct same-realm object reference.
 *   All host↔iframe communication flows through the host's
 *   `sendSlotMessage` / `onSlotMessage` (iframe side) and
 *   `_pushToIframe` / `_onIframeMessage` (host side) methods.
 *   No raw `postMessage` or `addEventListener('message')` is used.
 */

import { useEffect, useRef, useCallback, type ReactElement } from "react";
import type {
  UiPluginHostInternal,
} from "@agent-type";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface IframeSandboxProps {
  /** DOM id for the wrapper div. */
  readonly id?: string;
  /** CSS class for the wrapper div. */
  readonly className?: string;
  /** The plugin's UI entry URL. */
  readonly uiEntryUrl: string;
  /** The UiPluginHostInternal to inject into the iframe. */
  readonly host: UiPluginHostInternal;
  /** Called when the iframe is loaded and the host is injected. */
  readonly onReady: (iframe: HTMLIFrameElement) => void;
  /** Called when the iframe fails to load or create. */
  readonly onError?: (error: Error) => void;
  /** Additional sandbox flags. */
  readonly sandboxFlags?: readonly string[];
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
    sizing = "fill",
    containingWidth,
    containingHeight,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const destroyedRef = useRef(false);

  const cw = containingWidth ?? "auto";
  const ch = containingHeight ?? "auto";

  const createSandbox = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // R1: error isolation.
    try {
      const iframe = document.createElement("iframe");

      // R5: sandbox.
      const flags = sandboxFlags ?? ["allow-scripts", "allow-same-origin"];
      for (const flag of flags) {
        iframe.sandbox.add(flag);
      }

      iframe.style.width = sizing === "fit" ? cw : "100%";
      iframe.style.height = sizing === "fit" ? ch : "100%";
      iframe.style.border = "none";
      if (sizing === "fit") {
        iframe.style.display = "inline-block";
        iframe.style.verticalAlign = "middle";
        iframe.style.overflow = "hidden";
      }
      iframe.setAttribute("aria-label", `Plugin slot iframe`);

      // D6: inject host when iframe loads.
      iframe.addEventListener("load", () => {
        if (destroyedRef.current) return;
        try {
          const win = iframe.contentWindow as (Window & { __UAP_PLUGIN_HOST__?: UiPluginHostInternal }) | null;
          if (win) {
            win.__UAP_PLUGIN_HOST__ = host;
          }
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
  }, [uiEntryUrl, host, onReady, onError, sandboxFlags, cw, ch, sizing]);

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
  }, [uiEntryUrl]);

  return (
    <div
      ref={containerRef}
      id={id}
      className={className}
      style={sizing === "fit"
        ? { display: "inline-block", width: cw, height: ch, verticalAlign: "middle", overflow: "hidden" }
        : { width: "100%", height: "100%" }
      }
    />
  );
}
