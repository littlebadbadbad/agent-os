/**
 * agent-UI/slots/renderers/InlinePromptSlotRenderer.tsx
 *
 * Renders an inlinePrompt slot as a sandboxed iframe overlay.
 * Host creation and session subscription are delegated to
 * {@link useSlotHostBridge}.
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
  /**
   * Optional slot declaration override.
   * When provided (e.g. by sub-agent slots), used for dimensions.
   * Falls back to global slotRegistry when omitted.
   */
  readonly declaration?: InlinePromptSlotDeclaration;
  readonly className?: string;
}

export function InlinePromptSlotRenderer(
  props: InlinePromptSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, session, declaration: propsDecl, className } = props;

  const uiPlugin = pluginSystem.getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  // Prefer caller-supplied declaration; fall back to global registry.
  const decl: InlinePromptSlotDeclaration | undefined =
    propsDecl ??
    (slotRegistry.getSlot(pluginId, slotId) as InlinePromptSlotDeclaration | undefined);
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
