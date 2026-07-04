import type { AgentTurnResponse, AgentStreamChunk } from './core';
import type { AgentMessage } from './message';

// ═══════════════════════════════════════════════════════════════════════════════
//  Widget types  (来自 src/types.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface Position {
  x: number;
  y: number;
}

/**
 * Framework-agnostic icon shown in the sidebar header.
 *
 * - `string`      — emoji or plain text (e.g. `"🤖"`, `"AI"`)
 * - `HTMLElement` — any DOM element constructed at runtime
 * - `SVGElement`  — an SVG element (e.g. from `document.createElementNS`)
 *
 * React nodes, Vue VNodes, or other framework-specific types are intentionally
 * NOT accepted here so the public API stays framework-agnostic.
 */
export type WidgetIcon = string | HTMLElement | SVGElement;

/**
 * Color tokens for customising the sidebar's accent theme.
 * The dark base palette (backgrounds, text, borders) is fixed.
 * Only accent/primary color values are overrideable.
 * All fields are optional — only the values you supply are applied.
 */
export interface WidgetTheme {
  /** Primary accent color: sidebar header gradient start, highlights, active indicators. */
  primaryColor?: string;
  /** Gradient end-stop for the accent gradient. Defaults to `primaryColor`. */
  primaryDarkColor?: string;
  /** Deepest accent shade used for text labels. */
  primaryDeepColor?: string;
  /** Light accent tint for hover/glow effects. */
  primaryLightColor?: string;
}

/**
 * Internal handler used by the widget layer.
 * Context is already injected and history is managed by `AgentSession`.
 * The `signal` is forwarded from the SDK's AbortController so the handler can
 * cancel in-flight network requests when the user clicks Stop.
 */
export type WidgetHandler = (
  messages: AgentMessage[],
  signal: AbortSignal,
) => Promise<AgentTurnResponse | ReadableStream<AgentStreamChunk>>;
