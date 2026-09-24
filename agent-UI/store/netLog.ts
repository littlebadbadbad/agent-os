/**
 * agent-UI/store/netLog.ts — In-memory recorder for all AppApiClient traffic.
 *
 * Captures every `call()` (request/response) and `connectStream()`
 * (bidirectional stream) made through the frontend API client, in a form
 * resembling a browser DevTools "Network" panel:
 *
 *   - request params, response result, thrown errors, timing
 *   - stream lifecycle: subscribe → data chunks → end / error / unsubscribe
 *
 * The store is transport-agnostic and React-agnostic: it is a hand-rolled
 * subscriber store (same contract as `providerStore`) so it can be fed from
 * the non-React `apiClient` layer and read via `useSyncExternalStore` in the
 * debug panel.
 *
 * Design notes:
 *   - Entries are mutated in place (cheap for high-frequency stream chunks);
 *     a monotonically increasing `version` drives re-renders, so the snapshot
 *     object is recreated on publish without copying the (capped) entry array.
 *   - Notifications are coalesced to one per animation frame, so a 30 fps
 *     live-view stream does not thrash React.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** How a request/response call finished. */
export type NetCallStatus = 'pending' | 'success' | 'error';

/** Lifecycle phase of a streaming connection. */
export type NetStreamPhase =
  | 'connecting'
  | 'subscribed'
  | 'open'
  | 'ended'
  | 'error'
  | 'closed';

/** Normalised error shape stored alongside an entry. */
export interface NetErrorInfo {
  readonly name: string;
  readonly message: string;
  readonly status?: string;
  readonly stack?: string;
}

/** A single captured data chunk on a stream (metadata + optional sample). */
export interface NetStreamChunk {
  readonly index: number;
  readonly at: number;
  readonly kind: 'json' | 'binary' | 'text';
  readonly bytes: number;
  /** Truncated JSON sample for 'json'/'text' chunks; undefined for binary. */
  readonly sample?: unknown;
}

/**
 * Incremental content aggregates kept for a stream so the debug panel can
 * show the *full* concatenated output (e.g. LLM token streams) instead of
 * only the capped chunk samples. Updated on every chunk, bounded by
 * `AGGREGATE_MAX_CHARS` / `AGGREGATE_MAX_FIELDS` with a `truncated` flag.
 */
export interface NetStreamAggregate {
  /** Concatenated text of every string chunk (plain-string streams). */
  text: string;
  /** Per top-level JSON key: concatenation of that key's string values. */
  readonly fields: Map<string, string>;
  /** How many chunks were plain strings / JSON objects / anything else. */
  textChunks: number;
  jsonChunks: number;
  otherChunks: number;
  /** True when a cap (chars or field count) dropped content. */
  truncated: boolean;
}

interface NetLogEntryBase {
  /** Monotonic id, stable across the entry lifetime. */
  readonly id: number;
  /** App id the client is bound to. */
  readonly appId: string;
  /** Method name (call) or stream name (connectStream). */
  readonly name: string;
  /** Request-time params, stored raw (rendered defensively by the UI). */
  readonly params: unknown;
  /** performance.now() at request start. */
  readonly startedAt: number;
  /** Date.now() wall-clock at request start, for display. */
  readonly wallTime: number;
}

export interface NetCallEntry extends NetLogEntryBase {
  readonly kind: 'call';
  status: NetCallStatus;
  /** performance.now() at completion; undefined while pending. */
  endedAt?: number;
  durationMs?: number;
  /** Resolved value (success) — stored raw. */
  result?: unknown;
  /** Serialized size of the response payload (bytes); undefined while pending. */
  resultBytes?: number;
  /** Failure info (error). */
  error?: NetErrorInfo;
}

export interface NetStreamEntry extends NetLogEntryBase {
  readonly kind: 'stream';
  phase: NetStreamPhase;
  /** performance.now() when subscribe() was called. */
  subscribedAt?: number;
  /** performance.now() when the connection was established / first chunk. */
  openedAt?: number;
  /** performance.now() at end / error / unsubscribe. */
  endedAt?: number;
  durationMs?: number;
  /** Total number of chunks received. */
  chunkCount: number;
  /** Total bytes received (binary) — JSON chunks contribute an estimate. */
  byteCount: number;
  /** Capped list of recent chunk samples for inspection. */
  chunks: NetStreamChunk[];
  /** Full-stream content aggregates (text / per-JSON-field concatenation). */
  readonly aggregate: NetStreamAggregate;
  error?: NetErrorInfo;
}

export type NetLogEntry = NetCallEntry | NetStreamEntry;

/** Immutable snapshot consumed by `useSyncExternalStore`. */
export interface NetLogSnapshot {
  readonly version: number;
  readonly entries: readonly NetLogEntry[];
}

// ── Limits ────────────────────────────────────────────────────────────────────

/** Maximum number of entries retained (ring buffer, oldest evicted). */
const MAX_ENTRIES = 1000;
/** Maximum chunk samples kept per stream (older samples dropped, count kept). */
const MAX_CHUNK_SAMPLES = 50;
/** Maximum characters kept for a JSON/text chunk sample. */
const MAX_SAMPLE_CHARS = 2000;
/** Maximum characters retained per aggregate (stream text / JSON field). */
const AGGREGATE_MAX_CHARS = 100_000;
/** Maximum distinct JSON field keys tracked by the aggregate. */
const AGGREGATE_MAX_FIELDS = 24;

// ── Store state ─────────────────────────────────────────────────────────────

let entries: NetLogEntry[] = [];
let version = 0;
let nextId = 1;
let snapshot: NetLogSnapshot = { version, entries };

const subscribers = new Set<() => void>();

/** Publish immediately — used for structural changes (add / status flips). */
function publish(): void {
  version += 1;
  snapshot = { version, entries };
  for (const fn of subscribers) fn();
}

/** Coalesce high-frequency updates (stream chunks) into one notify per frame. */
let frameScheduled = false;
function schedulePublish(): void {
  if (frameScheduled) return;
  frameScheduled = true;
  const schedule: (cb: () => void) => void =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
  schedule(() => {
    frameScheduled = false;
    publish();
  });
}

function pushEntry(entry: NetLogEntry): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ── Recording API (called from the apiClient decorator) ────────────────────────

export const netLog = {
  /** Start recording a request/response call. Returns the live entry. */
  startCall(appId: string, method: string, params: unknown): NetCallEntry {
    const entry: NetCallEntry = {
      id: nextId++,
      kind: 'call',
      appId,
      name: method,
      params,
      startedAt: now(),
      wallTime: Date.now(),
      status: 'pending',
    };
    pushEntry(entry);
    publish();
    return entry;
  },

  /** Mark a call successful and capture its result. */
  endCall(entry: NetCallEntry, result: unknown): void {
    if (entry.status !== 'pending') return;
    entry.endedAt = now();
    entry.durationMs = entry.endedAt - entry.startedAt;
    entry.status = 'success';
    entry.result = result;
    entry.resultBytes = payloadBytes(result);
    publish();
  },

  /** Mark a call failed and capture the error. */
  failCall(entry: NetCallEntry, error: unknown): void {
    if (entry.status !== 'pending') return;
    entry.endedAt = now();
    entry.durationMs = entry.endedAt - entry.startedAt;
    entry.status = 'error';
    entry.error = toErrorInfo(error);
    publish();
  },

  /** Start recording a stream connection (connectStream). Returns the live entry. */
  startStream(appId: string, streamName: string, params: unknown): NetStreamEntry {
    const entry: NetStreamEntry = {
      id: nextId++,
      kind: 'stream',
      appId,
      name: streamName,
      params,
      startedAt: now(),
      wallTime: Date.now(),
      phase: 'connecting',
      chunkCount: 0,
      byteCount: 0,
      chunks: [],
      aggregate: {
        text: '',
        fields: new Map<string, string>(),
        textChunks: 0,
        jsonChunks: 0,
        otherChunks: 0,
        truncated: false,
      },
    };
    pushEntry(entry);
    publish();
    return entry;
  },

  /** A stream's subscribe() was invoked. */
  streamSubscribed(entry: NetStreamEntry): void {
    if (entry.phase === 'connecting') {
      entry.subscribedAt = now();
      entry.phase = 'subscribed';
      publish();
    }
  },

  /** A data chunk arrived on a stream. */
  streamChunk(entry: NetStreamEntry, chunk: unknown): void {
    const meta = describeChunk(chunk);
    entry.chunkCount += 1;
    entry.byteCount += meta.bytes;
    updateAggregate(entry.aggregate, chunk);
    if (entry.phase === 'connecting' || entry.phase === 'subscribed') {
      entry.openedAt = now();
      entry.phase = 'open';
    }
    if (entry.chunks.length < MAX_CHUNK_SAMPLES) {
      entry.chunks.push({ index: entry.chunkCount - 1, at: now() - entry.startedAt, ...meta });
    }
    schedulePublish();
  },

  /** A stream ended normally (onEnd). */
  streamEnded(entry: NetStreamEntry): void {
    if (entry.phase === 'ended' || entry.phase === 'closed' || entry.phase === 'error') return;
    entry.endedAt = now();
    entry.durationMs = entry.endedAt - entry.startedAt;
    entry.phase = 'ended';
    publish();
  },

  /** A stream errored (onError). */
  streamFailed(entry: NetStreamEntry, error: unknown): void {
    entry.endedAt = now();
    entry.durationMs = entry.endedAt - entry.startedAt;
    entry.phase = 'error';
    entry.error = toErrorInfo(error);
    publish();
  },

  /** A stream's unsubscribe() was called by the consumer. */
  streamUnsubscribed(entry: NetStreamEntry): void {
    if (entry.phase === 'ended' || entry.phase === 'closed' || entry.phase === 'error') return;
    entry.endedAt = now();
    entry.durationMs = entry.endedAt - entry.startedAt;
    entry.phase = 'closed';
    publish();
  },

  /** Drop all recorded entries. */
  clear(): void {
    entries = [];
    publish();
  },

  // ── Subscription (useSyncExternalStore contract) ──────────────────────────

  subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  },

  getSnapshot(): NetLogSnapshot {
    return snapshot;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Serialized size of a payload, or undefined when not measurable. */
export function payloadBytes(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : json.length;
  } catch {
    return undefined;
  }
}

/** Normalise an unknown thrown value into a displayable error record. */
export function toErrorInfo(error: unknown): NetErrorInfo {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    return {
      name: error.name,
      message: error.message,
      status: typeof status === 'string' ? status : undefined,
      stack: error.stack,
    };
  }
  return { name: 'Error', message: String(error) };
}

interface ChunkMeta {
  kind: NetStreamChunk['kind'];
  bytes: number;
  sample?: unknown;
}

/** Fold one raw chunk into the stream's incremental aggregates. Never throws. */
function updateAggregate(agg: NetStreamAggregate, chunk: unknown): void {
  if (typeof chunk === 'string') {
    agg.textChunks += 1;
    agg.text = appendCapped(agg.text, chunk, agg);
    return;
  }
  if (isPlainObject(chunk)) {
    agg.jsonChunks += 1;
    for (const [key, value] of Object.entries(chunk)) {
      if (typeof value !== 'string' || value.length === 0) continue;
      let cur = agg.fields.get(key);
      if (cur === undefined) {
        if (agg.fields.size >= AGGREGATE_MAX_FIELDS) {
          agg.truncated = true;
          continue;
        }
        cur = '';
        agg.fields.set(key, cur);
      }
      agg.fields.set(key, appendCapped(cur, value, agg));
    }
    return;
  }
  agg.otherChunks += 1;
}

/** `a + b` clamped to AGGREGATE_MAX_CHARS, flagging truncation. */
function appendCapped(a: string, b: string, agg: NetStreamAggregate): string {
  const room = AGGREGATE_MAX_CHARS - a.length;
  if (b.length <= room) return a + b;
  agg.truncated = true;
  return room > 0 ? a + b.slice(0, room) : a;
}

/** Non-array, non-binary object — the only shape with concatenable fields. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer) &&
    !(ArrayBuffer.isView(value))
  );
}

/** Classify a stream chunk and extract a bounded sample without retaining blobs. */
function describeChunk(chunk: unknown): ChunkMeta {
  if (typeof chunk === 'string') {
    return {
      kind: 'text',
      bytes: chunk.length,
      sample: chunk.length > MAX_SAMPLE_CHARS ? `${chunk.slice(0, MAX_SAMPLE_CHARS)}…` : chunk,
    };
  }
  if (chunk instanceof ArrayBuffer) {
    return { kind: 'binary', bytes: chunk.byteLength };
  }
  if (ArrayBuffer.isView(chunk)) {
    return { kind: 'binary', bytes: chunk.byteLength };
  }
  // JSON-serialisable control message.
  let bytes = 0;
  let sample: unknown = chunk;
  try {
    const json = JSON.stringify(chunk);
    bytes = json ? json.length : 0;
    if (json && json.length > MAX_SAMPLE_CHARS) {
      sample = { truncated: true, preview: json.slice(0, MAX_SAMPLE_CHARS) };
    }
  } catch {
    bytes = 0;
    sample = '[unserialisable]';
  }
  return { kind: 'json', bytes, sample };
}
