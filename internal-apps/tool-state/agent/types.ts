/** Snapshot of a single tool's enabled/disabled state. */
export interface ToolStateEntry {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  /**
   * True when the tool is globally disabled via the toolButton control:
   * it is force-off in every session and cannot be toggled from a
   * per-session panel (rendered greyed-out / non-interactive).
   */
  readonly locked?: boolean;
  /**
   * True for resident tools (e.g. `manage_tools`): always enabled in every
   * scope and not togglable from any control surface.
   */
  readonly resident?: boolean;
  readonly group?: string;
}

/** State payload exposed through the ToolState symbol. */
export interface ToolStateSymbolState {
  readonly type: 'toolState';
  readonly toolStates: readonly ToolStateEntry[];
  readonly toggleTool: (name: string) => void;
}

// ── Module augmentation ───────────────────────────────────────────────────────

export {};

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Tool enabled/disabled overrides. Key=toolName, value=true (enabled). */
    toolStates?: Record<string, boolean>;
  }

  interface AppStateExtension {
    readonly type?: 'toolState';
    readonly toolStates?: readonly ToolStateEntry[];
    readonly toggleTool?: (name: string) => void;
  }
}
