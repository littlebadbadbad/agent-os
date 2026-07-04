// ── Module augmentation side-effect ──────────────────────────────────────────
// Importing this module registers the AgentSessionExtension and
// SessionEntryExtension fields.  Must be a proper ES module.
export {};

// ── Graph primitives ──────────────────────────────────────────────────────────

/** A single entity, concept, or fact in the knowledge graph. */
export type KnowledgeNode = {
  /** Unique, stable, lowercase kebab-case identifier (e.g. `"user-auth-system"`). */
  id: string;
  /** Short human-readable name (e.g. `"User Auth System"`). */
  label: string;
  /** Rich description of the entity or concept. */
  description: string;
  /** Optional categorisation tags. */
  tags?: string[];
};

/** A directed relationship between two nodes. */
export type KnowledgeEdge = {
  /** `id` of the source node. */
  from: string;
  /** `id` of the target node. */
  to: string;
  /** Concise verb phrase (e.g. `"owns"`, `"depends_on"`, `"created_by"`). */
  relation: string;
};

/** The full knowledge graph for one conversation scope. */
export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  /** ISO timestamp of the last update. */
  updatedAt: string;
  /** How many times the graph has been updated via distillation. */
  updateCount: number;
};

// ── Persistence & state types ─────────────────────────────────────────────────

/**
 * Shape persisted in `SessionEntryData.memoryGraph`.
 *
 * One instance per scope — the main agent session or a single sub-agent
 * conversation — stored and restored symmetrically via `onBuildSnapshot` /
 * `onInitSession`.
 */
export type SerializedMemoryGraph = KnowledgeGraph;

/**
 * Contribution to `AgentSessionState` via `onGetState`.
 * Surfaced to the UI so it can render graph information.
 */
export type MemoryGraphState = {
  /** The current knowledge graph, or `undefined` if none has been built yet. */
  graph?: KnowledgeGraph;
};

/** Factory options for the MemoryGraph ToolSet. */
export type MemoryGraphToolSetOptions = {
  /**
   * Maximum number of nodes to inject into the system prompt.
   * When the graph has more nodes, only the most recently added ones are shown.
   * @default 15
   */
  maxNodesInPrompt?: number;
  /**
   * Maximum character length for node descriptions in the system prompt.
   * Longer descriptions are truncated with an ellipsis.
   * @default 150
   */
  maxDescriptionLength?: number;
};

// ── Module augmentations ──────────────────────────────────────────────────────

declare module '@agent-type' {
  interface SessionEntryExtension {
    /**
     * Persisted knowledge graph for this scope (main session or sub-agent
     * conversation).  Restored in `onInitSession` and serialised in
     * `onBuildSnapshot`.
     */
    memoryGraph?: KnowledgeGraph;
  }
}

declare module '@agent-type' {
  interface AgentSessionExtension {
    /** Live knowledge graph state exposed to the UI. */
    memoryGraph?: MemoryGraphState;
  }
}
