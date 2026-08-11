import type { Attachment, AppStateExtension } from '@agent-type';

declare module '@agent-type' {
  interface AgentSessionExtension {
    variables?: readonly VariableEntry[];
    variableStore?: VariableStoreRef;
  }
}

// ── Symbol state (for onGetSymbolState) ────────────────────────────────────────

export const VARIABLE_SYMBOL = Symbol.for('sdk.VariableToolSet');

export interface VariableSymbolState extends AppStateExtension {
  readonly type: 'variable';
  readonly variables: readonly VariableEntry[];
  readonly variableStore: VariableStoreRef;
}

// ── JSON value types ──────────────────────────────────────────────────────────

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

// ── Variable kinds ────────────────────────────────────────────────────────────

export type VariableHandle = `$var:${string}`;

/**
 * A JSON-serializable value captured from tool results or written manually.
 * All variable data (strings, objects, arrays, numbers…) is stored under this kind.
 */
export type JsonVariable = {
  readonly kind: 'json';
  readonly value: JsonValue;
};

export type AttachmentVariable = {
  readonly kind: 'attachment';
  readonly attachment: Attachment;
};

export type Variable = JsonVariable | AttachmentVariable;

// ── Variable entry (in-memory record) ────────────────────────────────────────

export type VariableEntry = Variable & {
  readonly handle: VariableHandle;
  readonly name?: string;
  readonly source: 'tool-result' | 'user';
  readonly toolName?: string;
  /** JSON byte length for json variables; estimated binary size for attachments. */
  readonly size: number;
  readonly createdAt: number;
};

// ── Serialized form (for persistence) ────────────────────────────────────────

/** Only JSON variables are persisted; attachment variables are runtime-only. */
export type SerializedVariable = {
  readonly handle: VariableHandle;
  readonly name?: string;
  readonly source: 'tool-result' | 'user';
  readonly toolName?: string;
  readonly size: number;
  readonly createdAt: number;
  readonly kind: 'json';
  readonly value: JsonValue;
};

// ── Store interface ───────────────────────────────────────────────────────────

export type VariableStore = {
  store(variable: Variable, opts?: { name?: string; source?: VariableEntry['source']; toolName?: string }): VariableHandle;
  resolve(handle: VariableHandle): VariableEntry | undefined;
  list(): readonly VariableEntry[];
  delete(handle: VariableHandle): boolean;
  clear(): void;
  subscribe(fn: () => void): () => void;
  getSnapshot(): readonly VariableEntry[];
};

export type VariableStoreRef = {
  list(): readonly VariableEntry[];
  delete(handle: VariableHandle): boolean;
  clear(): void;
};
