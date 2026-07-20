/**
 * extensions/experience/agent/types.ts — Shared types + module augmentation
 *
 * Defines experience record types and augments @agent-type interfaces
 * so the ToolSet's state can be carried through session snapshots.
 */

// ── Experience types ──────────────────────────────────────────────────────────

export type ExperienceItem = {
  id: string;
  createdAt: string;
  trigger: string;
  insight: string;
  evidence?: string;
  confidence?: number;
  tags?: readonly string[];
};

export type ExperienceInput = {
  trigger: string;
  insight: string;
  evidence?: string;
  confidence?: number;
  tags?: string[];
};

export type ExperienceStore = {
  add(input: ExperienceInput): ExperienceItem;
  update(id: string, patch: Partial<ExperienceInput>): boolean;
  remove(id: string): boolean;
  exportJSON(): string;
  importJSON(json: string): { imported: number; skipped: number };
  copyToClipboard(): Promise<void>;
  importFromClipboard(): Promise<{ imported: number; skipped: number }>;
};

export type ExperienceSymbolState = {
  readonly type: 'experience';
  readonly experiences: readonly ExperienceItem[];
  readonly experienceStore: ExperienceStore | undefined;
};

// ── Module augmentation ───────────────────────────────────────────────────────

declare module '@agent-type' {
  interface SessionEntryExtension {
    experiences?: ExperienceItem[];
  }
}
