// ── Types ─────────────────────────────────────────────────────────────────────

export type GitFileEntry = {
  path: string;
  /** Single-character git status code: M, A, D, R, C, U, … */
  status: string;
};

export type GitStatusResult = {
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
};

export type GitDiffResult = {
  output: string;
};

export type GitLogEntry = {
  hash: string;
  subject: string;
};

export type GitCommitResult = {
  hash: string;
  subject: string;
};

// ── GitAdapter ────────────────────────────────────────────────────────────────

export type GitAdapter = {
  /** Show working tree status (staged / unstaged / untracked). */
  status(): Promise<GitStatusResult>;

  /** Show diff. `staged=true` for index vs HEAD; `paths` to limit scope. */
  diff(opts?: { staged?: boolean; paths?: string[] }): Promise<GitDiffResult>;

  /** Show recent commits. */
  log(limit?: number): Promise<{ entries: GitLogEntry[] }>;

  /** Stage files (`git add`). Omit or pass `[]` to stage all changes. */
  stage(paths?: string[]): Promise<{ staged: string[] }>;

  /** Unstage files (`git restore --staged`). Omit or pass `[]` to unstage all. */
  unstage(paths?: string[]): Promise<{ unstaged: string[] }>;

  /** Create a commit with the given message. */
  commit(message: string): Promise<GitCommitResult>;

  /**
   * Discard unstaged changes (`git restore`).
   * Paths must be explicitly provided — no accidental full-tree discard.
   */
  discard(paths: string[]): Promise<{ discarded: string[] }>;
};
