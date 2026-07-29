/** Snapshot of a single tool's enabled/disabled state. */
export interface ToolStateEntry {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly group?: string;
}

/** State payload exposed through the ToolState symbol. */
export interface ToolStateSymbolState {
  readonly type: 'toolState';
  readonly toolStates: readonly ToolStateEntry[];
  readonly toggleTool: (name: string) => void;
}

/** A deferred-tool entry returned by `tool_search`. */
export interface ToolSearchResult {
  readonly name: string;
  readonly summary: string;
}

// ── Module augmentation ───────────────────────────────────────────────────────

export {};

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Tool enabled/disabled overrides. Key=toolName, value=true (enabled). */
    toolStates?: Record<string, boolean>;
  }

  interface PluginStateExtension {
    readonly type?: 'toolState';
    readonly toolStates?: readonly ToolStateEntry[];
    readonly toggleTool?: (name: string) => void;
  }
}
