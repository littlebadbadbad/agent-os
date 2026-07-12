// ── Module augmentation ───────────────────────────────────────────────────────
import type { PluginUiAdapter } from '@agent-type';

/** Snapshot of a single tool's enabled/disabled state. */
export interface ToolStateEntry {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly group?: string;
}

export {};

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Tool enabled/disabled overrides. Key=toolName, value=true (enabled). */
    toolStates?: Record<string, boolean>;
  }
}

// ── Symbol state interface ────────────────────────────────────────────────────

export interface ToolStateSymbolState extends PluginUiAdapter {
  readonly type: 'toolState';
  readonly toolStates: readonly ToolStateEntry[];
  readonly toggleTool: (name: string) => void;
}

declare module "@agent-type" {
  interface PluginStateExtension {
    readonly type: 'toolState';
    readonly toolStates: readonly ToolStateEntry[];
    readonly toggleTool: (name: string) => void;
  }
}
