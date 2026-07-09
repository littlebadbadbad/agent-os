/**
 * agent-UI/slots/renderers/InlinePromptSlotRenderer.tsx
 *
 * Renders an inlinePrompt slot as a sandboxed iframe overlay.
 * Host creation and session subscription are delegated to
 * {@link useSlotHostBridge}.
 *
 * Slot declaration is always read from the global slotRegistry.
 */

import { type ReactElement } from "react";
import { IframeSandbox } from "../IframeSandbox";
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import type { SlotSession, InlinePromptSlotDeclaration } from "@agent-type";
import { slotRegistry } from "../registry";
import { pluginSystem } from "../../agents";

export interface InlinePromptSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly className?: string;
}

export function InlinePromptSlotRenderer(
  props: InlinePromptSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, session, className } = props;

  const uiPlugin = pluginSystem.getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  // Read dimensions from slot declaration, fall back to sensible defaults.
  const decl = slotRegistry.getSlot(pluginId, slotId) as InlinePromptSlotDeclaration | undefined;
  const containingWidth = decl?.containingWidth ?? "100%";
  const containingHeight = decl?.containingHeight ?? "auto";

  const { host, handleReady } = useSlotHostBridge({
    session,
    pluginId,
    slotId,
    slotType: "inlinePrompt",
    uiPlugin,
  });

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiPlugin.uiEntryUrl}
      host={host}
      onReady={handleReady}
      sizing="fit"
      containingWidth={containingWidth}
      containingHeight={containingHeight}
    />
  );
}
