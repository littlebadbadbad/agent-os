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
import { getSlotPermissions } from "../iframePermissions";
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import type { SlotSession, PluginSlotDeclaration } from "@agent-type";
import { useSlotRegistry, usePluginSystem } from "../../plugin/PluginContext";

export interface InlinePromptSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly toolSetSymbol: symbol;
  /** Direct declaration for sub-agent slots (bypasses global slotRegistry). */
  readonly declaration?: PluginSlotDeclaration;
  readonly className?: string;
}

export function InlinePromptSlotRenderer(
  props: InlinePromptSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, session, toolSetSymbol, declaration, className } = props;

  const { getPlugin } = usePluginSystem();
  const { getSlot } = useSlotRegistry();
  const uiPlugin = getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  // Read dimensions from explicit declaration (sub-agent path) or fall back
  // to the slotRegistry (main-agent path).
  const rawDecl = declaration ?? getSlot(pluginId, slotId)?.declaration;
  // Discriminant narrowing — no cast needed.
  const inlineDecl = rawDecl?.type === "inlinePrompt" ? rawDecl : undefined;
  const containingWidth = inlineDecl?.containingWidth ?? "100%";
  const containingHeight = inlineDecl?.containingHeight ?? "auto";

  const { host, handleReady } = useSlotHostBridge({
    session,
    pluginId,
    slotId,
    slotType: "inlinePrompt",
    toolSetSymbol,
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
      permissions={inlineDecl?.permissions}
    />
  );
}
