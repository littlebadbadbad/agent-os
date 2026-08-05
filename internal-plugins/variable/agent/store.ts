import type { Variable, VariableEntry, VariableHandle, VariableStore, VariableStoreRef, SerializedVariable } from './types';

/** Matches a bare handle: `$var:a1b2c3d4` */
const HANDLE_ONLY_RE = /^\$var:[0-9a-f]{8}$/;

/**
 * Matches a handle optionally followed by a JSON path suffix.
 * e.g. `$var:a1b2c3d4`, `$var:a1b2c3d4.a.b[0].c`
 * Path characters: word chars, `.`, `[`, `]`.
 */
export const HANDLE_REF_RE = /\$var:[0-9a-f]{8}(?:[.[\[][a-zA-Z0-9_.\[\]]*)?/g;

export type HandleRef = { handle: VariableHandle; path: string };

/**
 * Split a handle-with-optional-path reference into its parts.
 * `"$var:a1b2c3d4.x.y[0]"` → `{ handle: "$var:a1b2c3d4", path: "x.y[0]" }`
 * `"$var:a1b2c3d4"`        → `{ handle: "$var:a1b2c3d4", path: "" }`
 * Returns `null` when the string is not a valid reference.
 */
export function parseHandleRef(ref: string): HandleRef | null {
  const bare = ref.slice(0, 13); // '$var:' + 8 hex = 13 chars
  if (!HANDLE_ONLY_RE.test(bare) && !ref.startsWith('$var:')) return null;
  const match = /^(\$var:[0-9a-f]{8})([.[\[].*)?$/.exec(ref);
  if (!match) return null;
  const rawSuffix = match[2] ?? '';
  // Strip a leading '.' so 'a.b' and '[0].b' both parse cleanly via parsePath.
  const path = rawSuffix.startsWith('.') ? rawSuffix.slice(1) : rawSuffix;
  return { handle: match[1] as VariableHandle, path };
}

export function isVariableHandle(s: string): s is VariableHandle {
  return HANDLE_ONLY_RE.test(s);
}

export function extractHandles(s: string): VariableHandle[] {
  const re = /\$var:[0-9a-f]{8}/g;
  return (s.match(re) ?? []) as VariableHandle[];
}

function generateHandle(): VariableHandle {
  return `$var:${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}` as VariableHandle;
}

function computeSize(v: Variable): number {
  if (v.kind === 'json') return JSON.stringify(v.value).length;
  if (v.attachment.source === 'data') return Math.round(v.attachment.data.length * 0.75);
  return 0;
}

type InternalStore = VariableStore & {
  restore(entry: VariableEntry): void;
};

function createVariableStore(): InternalStore {
  const entries = new Map<VariableHandle, VariableEntry>();
  const subs = new Set<() => void>();

  function notify() {
    for (const fn of subs) fn();
  }

  return {
    store(variable, opts = {}) {
      const handle = generateHandle();
      const entry: VariableEntry = {
        ...variable,
        handle,
        size: computeSize(variable),
        createdAt: Date.now(),
        source: opts.source ?? 'tool-result',
        ...(opts.name !== undefined && { name: opts.name }),
        ...(opts.toolName !== undefined && { toolName: opts.toolName }),
      };
      entries.set(handle, entry);
      notify();
      return handle;
    },

    restore(entry) {
      if (!entries.has(entry.handle)) {
        entries.set(entry.handle, entry);
      }
    },

    resolve(handle) {
      return entries.get(handle);
    },

    list() {
      return [...entries.values()];
    },

    delete(handle) {
      const deleted = entries.delete(handle);
      if (deleted) notify();
      return deleted;
    },

    clear() {
      entries.clear();
      notify();
    },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    getSnapshot() {
      return [...entries.values()];
    },
  };
}

const sessionStores = new Map<string, InternalStore>();

export function getSessionStore(sessionId: string): InternalStore {
  let store = sessionStores.get(sessionId);
  if (!store) {
    store = createVariableStore();
    sessionStores.set(sessionId, store);
  }
  return store;
}

export function deleteSessionStore(sessionId: string): void {
  sessionStores.delete(sessionId);
}

export function buildStoreRef(store: VariableStore): VariableStoreRef {
  return {
    list: () => store.list(),
    delete: (h) => store.delete(h),
    clear: () => store.clear(),
  };
}

/** Serialize all JSON variables for persistence. Attachment variables are skipped (runtime-only). */
export function serializeVariables(store: VariableStore): SerializedVariable[] {
  return store.list()
    .filter((e): e is VariableEntry & { kind: 'json' } => e.kind === 'json')
    .map(({ handle, name, source, toolName, size, createdAt, value }) => ({
      kind: 'json' as const,
      handle,
      size,
      createdAt,
      source,
      value,
      ...(name !== undefined && { name }),
      ...(toolName !== undefined && { toolName }),
    }));
}

export function restoreVariables(store: VariableStore, saved: SerializedVariable[]): void {
  const internal = store as InternalStore;
  for (const v of saved) {
    internal.restore({
      kind: 'json',
      handle: v.handle,
      value: v.value,
      size: v.size,
      createdAt: v.createdAt,
      source: v.source,
      ...(v.name !== undefined && { name: v.name }),
      ...(v.toolName !== undefined && { toolName: v.toolName }),
    });
  }
}
