// ── Plan store ────────────────────────────────────────────────────────────────
//
// Per-session markdown plan storage + plan-mode flag.  Keyed by `ctxKey(ctx)`.

type Bucket = {
  content: string;
  planMode: boolean;
  subs: Set<() => void>;
};

const buckets = new Map<string, Bucket>();

function getOrCreate(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { content: '', planMode: false, subs: new Set() };
    buckets.set(key, b);
  }
  return b;
}

function notify(key: string): void {
  buckets.get(key)?.subs.forEach((fn) => fn());
}

export const planStore = {
  get(key: string): string | undefined {
    return buckets.get(key)?.content || undefined;
  },

  set(key: string, content: string): void {
    getOrCreate(key).content = content;
    notify(key);
  },

  getPlanMode(key: string): boolean {
    return buckets.get(key)?.planMode ?? false;
  },

  setPlanMode(key: string, active: boolean): void {
    getOrCreate(key).planMode = active;
    notify(key);
  },

  reset(key: string): void {
    const b = buckets.get(key);
    if (b) {
      b.content = '';
      b.planMode = false;
      notify(key);
    }
  },

  remove(key: string): void {
    buckets.delete(key);
  },

  subscribe(key: string, fn: () => void): () => void {
    const b = getOrCreate(key);
    b.subs.add(fn);
    return () => { b.subs.delete(fn); };
  },

  serialize(key: string): { content: string; planMode: boolean } | undefined {
    const b = buckets.get(key);
    if (!b || (!b.content && !b.planMode)) return undefined;
    return { content: b.content, planMode: b.planMode };
  },
};
