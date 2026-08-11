// ── Module augmentation ───────────────────────────────────────────────────────
export {};

import type { PendingApproval } from './store';

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Persisted plan markdown content for this session. */
    plan?: string;
    /** Whether the session is in plan mode (design only, no execution). */
    planMode?: boolean;
    /** Persisted pending approval context (detached prompt). */
    planPendingApproval?: PendingApproval;
  }
}

// ── Symbol state interface ────────────────────────────────────────────────────

/**
 * The state slice returned by the plan ToolSet's `onGetSymbolState`.
 *
 * Stored under `state[PLAN_SYMBOL]` in the session state, isolating
 * plan state from the root `AgentSessionState`.
 */
export interface PlanSymbolState {
  readonly type: 'plan';
  readonly plan?: string;
  readonly planMode?: boolean;
  readonly pendingApproval?: PendingApproval | null;
}

// ── Module augmentation — direct field access in UI ──────────────────────────
// Single-ToolSet apps augment AppStateExtension so the iframe UI
// can access fields without casts: state?.plan, state?.planMode, etc.

declare module "@agent-type" {
  interface AppStateExtension {
    readonly type: 'plan';
    readonly plan?: string;
    readonly planMode?: boolean;
    readonly pendingApproval?: PendingApproval | null;
  }
}

// ── Per-tool result types ─────────────────────────────────────────────────────
//
// Each plan tool returns a specific result shape.  These types form a
// discriminated union that apps consume via `ToolCallInfo<PlanToolResult>`
// — eliminating the need for `as Record<string, unknown>` casts.

/** plan_write: always succeeds — the store is the source of truth. */
export interface PlanWriteResult {
  readonly success: true;
}

/** plan_checkpoint: user responds with approve / reject (+feedback) / cancel. */
export interface PlanCheckpointApproved {
  readonly status: 'approved';
}
export interface PlanCheckpointRejected {
  readonly status: 'rejected';
  readonly feedback: string;
}
export interface PlanCheckpointCancelled {
  readonly status: 'cancelled';
}

/**
 * plan_checkpoint / plan_exit: prompt sent via detached mode.
 * The tool returns immediately; the agent waits for user input.
 */
export interface PlanAwaitingInput {
  readonly status: 'awaiting_input';
  readonly message: string;
}

/** plan_enter: switches to read-only plan mode. */
export interface PlanEnterResult {
  readonly status: 'plan_mode_entered';
  readonly message: string;
}

/** plan_exit: submits for approval — several outcomes. */
export interface PlanExitApproved {
  readonly status: 'approved';
  readonly message: string;
}
export interface PlanExitNoPlan {
  readonly status: 'no_plan';
  readonly message: string;
}
export interface PlanExitCancelled {
  readonly status: 'cancelled';
}
export interface PlanExitChangesRequested {
  readonly status: 'changes_requested';
  readonly feedback: string;
}

/** plan_verify: analyses the plan's numbered steps. */
export interface PlanVerifyResult {
  readonly total: number;
  readonly completed: number;
  readonly pending: number;
  readonly steps: ReadonlyArray<{
    readonly description: string;
    readonly done: boolean;
  }>;
}

/**
 * Discriminated union of all plan tool execution results.
 *
 * Narrow by checking for discriminant properties:
 *   `'status' in result`   → excludes {@link PlanWriteResult}
 *   `'total' in result`    → narrows to {@link PlanVerifyResult}
 *   `'success' in result`  → narrows to {@link PlanWriteResult}
 */
export type PlanToolResult =
  | PlanWriteResult
  | PlanCheckpointApproved
  | PlanCheckpointRejected
  | PlanCheckpointCancelled
  | PlanEnterResult
  | PlanExitApproved
  | PlanExitNoPlan
  | PlanExitCancelled
  | PlanExitChangesRequested
  | PlanVerifyResult;

/** All plan tool names (used by the type-predicate at the UI boundary). */
export const PLAN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'plan_write',
  'plan_checkpoint',
  'plan_enter',
  'plan_exit',
  'plan_verify',
]);
