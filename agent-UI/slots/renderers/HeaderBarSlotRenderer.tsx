/**
 * agent-UI/slots/renderers/HeaderBarSlotRenderer.tsx
 *
 * Renders a headerBar slot as a sandboxed iframe.
 *
 * A headerBar slot is a thin full-width bar rendered above the tab bar.
 * Host creation and session subscription are delegated to
 * {@link useSlotHostBridge}.
 *
 * Uses `sizing="fit"` so dimensions are driven by the slot declaration's
 * `containingWidth`/`containingHeight` (e.g. "100%" × "28px").
 */

import { type ReactElement } from "react";
import type { SlotSession } from "@agent-type";
import { IframeSandbox } from "../IframeSandbox";
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import { useSlotRegistry, useAppSystem } from "../../app/AppContext";

export interface HeaderBarSlotRendererProps {
  readonly appId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function HeaderBarSlotRenderer(
  props: HeaderBarSlotRendererProps,
): ReactElement | null {
  const { appId, slotId, session, toolSetSymbol, className } = props;

  const { getApp } = useAppSystem();
  const uiApp = getApp(appId);
  if (!uiApp?.uiEntryUrl) return null;

  // Read dimensions from slot declaration, fall back to sensible defaults.
  const { getSlot } = useSlotRegistry();
  const slotEntry = getSlot(appId, slotId);
  // Discriminant narrowing — no cast needed.
  const headerDecl = slotEntry?.declaration.type === "headerBar" ? slotEntry.declaration : undefined;
  const containingWidth = headerDecl?.containingWidth ?? "100%";
  const containingHeight = headerDecl?.containingHeight ?? "auto";

  const { host, handleReady } = useSlotHostBridge({
    session,
    appId,
    slotId,
    slotType: "headerBar",
    toolSetSymbol,
    uiApp,
  });

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiApp.uiEntryUrl}
      host={host}
      onReady={handleReady}
      sizing="fit"
      containingWidth={containingWidth}
      containingHeight={containingHeight}
      permissions={headerDecl?.permissions}
    />
  );
}
