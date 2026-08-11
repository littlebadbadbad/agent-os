/** Describes a detached prompt awaiting user response. */
export interface PendingApproval {
  /** Which tool issued the prompt: `'checkpoint'` or `'exit'`. */
  readonly stage: 'checkpoint' | 'exit';
  /** The original message shown to the user (for reference). */
  readonly message: string;
}

type Bucket = {
  content: string;
  planMode: boolean;
  pendingApproval: PendingApproval | null;
  subs: Set<() => void>;
};

const buckets = new Map<string, Bucket>();

function getOrCreate(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { content: '', planMode: false, pendingApproval: null, subs: new Set() };
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

  /** Set pending approval context (detached prompt state). */
  setPendingApproval(key: string, approval: PendingApproval | null): void {
    getOrCreate(key).pendingApproval = approval;
    notify(key);
  },

  /** Peek at pending approval without clearing it. */
  getPendingApproval(key: string): PendingApproval | null {
    return buckets.get(key)?.pendingApproval ?? null;
  },

  /** Get pending approval context, clearing it atomically. */
  consumePendingApproval(key: string): PendingApproval | null {
    const b = buckets.get(key);
    if (!b?.pendingApproval) return null;
    const val = b.pendingApproval;
    b.pendingApproval = null;
    notify(key);
    return val;
  },

  reset(key: string): void {
    const b = buckets.get(key);
    if (b) {
      b.content = '';
      b.planMode = false;
      b.pendingApproval = null;
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

  serialize(key: string): { content: string; planMode: boolean; pendingApproval?: PendingApproval } | undefined {
    const b = buckets.get(key);
    if (!b || (!b.content && !b.planMode && !b.pendingApproval)) return undefined;
    return { content: b.content, planMode: b.planMode, ...(b.pendingApproval ? { pendingApproval: b.pendingApproval } : {}) };
  },
};
