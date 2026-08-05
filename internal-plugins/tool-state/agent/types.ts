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

/** Full detail for the best match — everything the AI needs to invoke the tool. */
export interface ToolSearchDetail {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly score: number;
}

/** Summary for secondary matches — just enough to decide if it's the right tool. */
export interface ToolSearchSummary {
  readonly name: string;
  readonly description: string;
  readonly score: number;
}

/** Result shape returned by `tool_search`. */
export interface ToolSearchResults {
  readonly top: ToolSearchDetail | null;
  readonly others: readonly ToolSearchSummary[];
  readonly total: number;
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
