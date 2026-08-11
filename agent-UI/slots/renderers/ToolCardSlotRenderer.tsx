/**
 * agent-UI/slots/renderers/ToolCardSlotRenderer.tsx
 *
 * Renders a toolCard slot as a sandboxed iframe.
 *
 * Uses {@link useSlotHostBridge} for host creation and session subscription.
 * On iframe load, pushes the initial {@link ToolCardHostMessage} with the
 * tool call information via `host._pushToIframe`.
 *
 * Subsequently, whenever `toolCallInfo` changes (e.g. status transitions
 * from "running" to "done"), the new payload is pushed reactively via
 * a `useEffect` — ensuring the iframe always shows the latest state.
 */

import { useRef, useCallback, useEffect, type ReactElement } from "react";
import type { ToolCardHostMessage, SlotSession, UiAppHostInternal } from "@agent-type";
import type { ToolCallInfo } from "@agent-type";
import { IframeSandbox } from "../IframeSandbox";
import { getSlotPermissions } from "../iframePermissions";
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import { useAppSystem, useSlotRegistry } from "../../app/AppContext";

export interface ToolCardSlotRendererProps {
  readonly appId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly toolCallInfo: ToolCallInfo;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function ToolCardSlotRenderer(
  props: ToolCardSlotRendererProps,
): ReactElement | null {
  const { appId, slotId, session, toolCallInfo, toolSetSymbol, className } = props;

  const hostRef = useRef<UiAppHostInternal | null>(null);

  const { getApp } = useAppSystem();
  const uiApp = getApp(appId);
  if (!uiApp?.uiEntryUrl) return null;

  const { getSlot } = useSlotRegistry();
  const { host } = useSlotHostBridge({
    session,
    appId,
    slotId,
    slotType: "toolCard",
    toolSetSymbol,
    uiApp,
  });

  hostRef.current = host;

  // ── On iframe ready: push initial payload ───────────────────────────────────

  const handleReady = useCallback(
    (_iframe: HTMLIFrameElement) => {
      const h = hostRef.current;
      if (!h) return;

      const initMsg: ToolCardHostMessage = {
        version: 1,
        type: "toolCard",
        slotId,
        payload: { toolCallInfo },
      };
      h._pushToIframe(initMsg);
    },
    [slotId, toolCallInfo],
  );

  // ── Reactive updates: push whenever toolCallInfo changes ────────────────────

  useEffect(() => {
    const h = hostRef.current;
    if (!h) return;

    const msg: ToolCardHostMessage = {
      version: 1,
      type: "toolCard",
      slotId,
      payload: { toolCallInfo },
    };
    h._pushToIframe(msg);
  }, [toolCallInfo, slotId]);

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiApp.uiEntryUrl}
      host={host}
      onReady={handleReady}
      permissions={getSlotPermissions(getSlot(appId, slotId)?.declaration)}
    />
  );
}
