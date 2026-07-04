/**
 * agent-UI/components/AgentWidget/plugin/PluginSlot.tsx
 *
 * Generic iframe container that renders a plugin's UI entry point.
 *
 * Two modes:
 *   - **main**: Full panel mode.  Subscribes to session state and pushes
 *     state updates to the iframe via Link B.  The iframe reads
 *     `host.sessionState` directly (D6 — same-realm reference).
 *   - **toolCard**: Compact card mode.  No sessionState.  On iframe load,
 *     sends `{ type: 'toolCallInfo', payload: toolCallInfo }` via Link B.
 *
 * R1: All iframe creation is wrapped in try-catch.  On failure, a
 * fallback message is rendered.
 *
 * No plugin name is hardcoded — the slot is fully generic and driven
 * by the `pluginId` prop.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { AgentSession, AgentSessionState } from "@agent-sdk";
import type {
  AgentSessionExtension,
  ToolCallInfo,
  UapPluginMessage,
} from "@agent-type";
import { pluginSystem } from "../../../agents";
import {
  createUiPluginHost,
  createUiPluginSandbox,
  type UiPluginSandbox,
} from "../../../plugin";
import { createPluginApiClient } from "../../../plugin/apiClient";
import { createPluginConfigClient } from "../../../plugin/configClient";
import type { PluginManifest } from "@agent-type";
import { pick } from "@agent-UI/utils";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PluginSlotProps {
  /** Plugin id (kebab-case, matches manifest.id). */
  readonly pluginId: string;
  /** Rendering mode. */
  readonly panelType: "main" | "toolCard";
  /** Agent session (required for main mode). */
  readonly session?: AgentSession;
  /** Session ID (required for main mode). */
  readonly sessionId?: string;
  /** Tool call info (required for toolCard mode). */
  readonly toolCallInfo?: ToolCallInfo;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PluginSlot(props: PluginSlotProps): ReactElement | null {
  const { pluginId, panelType, session, sessionId, toolCallInfo } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<UiPluginSandbox | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the plugin descriptor to get the UI entry URL.
  const uiPlugin = pluginSystem.getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) {
    // No UI entry for this plugin — render nothing.
    return null;
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    try {
      // Create pre-bound API client for this plugin.
      const apiClient = createPluginApiClient(pluginId);

      // Create config client.
      const manifest: PluginManifest = {
        id: uiPlugin.id,
        name: uiPlugin.name,
        version: uiPlugin.version,
        description: uiPlugin.description,
      };
      const configClient = createPluginConfigClient(manifest, apiClient);
      const hostMessageSubscribers = new Set<(msg: UapPluginMessage) => void>();
      // Create the UiPluginHost.
      const host = createUiPluginHost({
        plugin: uiPlugin,
        apiClient,
        configClient,
        session,
        postMessageSender: (msg: UapPluginMessage) => {
          window.postMessage(msg, window.location.origin);
        },
        subscribe(cb: (msg: UapPluginMessage) => void): () => void {
          hostMessageSubscribers.add(cb);
          return () => {
            hostMessageSubscribers.delete(cb);
          };
        },
      });

      // Create the iframe sandbox.
      const sandbox = createUiPluginSandbox({
        container,
        uiEntryUrl: uiPlugin.uiEntryUrl!,
        host,
      });

      if (!sandbox) {
        setError("Failed to create plugin sandbox");
        return;
      }
      const sendHostMessage = (msg: UapPluginMessage) => {
        if (sandbox.destroyed) hostMessageSubscribers.forEach((cb) => cb(msg));
      };

      sandboxRef.current = sandbox;

      // Main mode: subscribe to session state changes.
      let unsubscribe: (() => void) | undefined;
      if (panelType === "main" && session) {
        unsubscribe = session.subscribe(() => {
          const nextState = session.getState();
          sendHostMessage({
            type: "stateUpdate",
            payload: nextState,
          });
        });
      }

      // ToolCard mode: send toolCallInfo on iframe load.
      if (panelType === "toolCard" && toolCallInfo) {
        // The sandbox's iframe load event fires asynchronously.
        // We send the message after a short delay to ensure the iframe
        // has registered its onHostMessage listener.
        setTimeout(() => {
          sendHostMessage({
            type: "toolCallInfo",
            payload: toolCallInfo,
          });
        }, 100);
      }

      return () => {
        hostMessageSubscribers.clear();
        unsubscribe?.();
        sandbox.destroy();
        sandboxRef.current = null;
      };
    } catch (err) {
      // R1: error isolation.
      setError(err instanceof Error ? err.message : String(err));
      console.warn(`[PluginSlot] Failed to load plugin "${pluginId}":`, err);
    }
  }, [pluginId, uiPlugin.uiEntryUrl, panelType, sessionId]);

  if (error) {
    return (
      <div className="plugin-slot-error">Plugin UI failed to load: {error}</div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="plugin-slot-container"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
