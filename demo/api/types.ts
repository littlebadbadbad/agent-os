// ── Azure DevOps data types ───────────────────────────────────────────────────

export interface AdoConfig {
  /** Server root URL, e.g. https://navi.united-imaging.com */
  serverUrl: string;
  /** Personal Access Token */
  pat: string;
}

/** Info about the currently authenticated PAT owner. */
export interface UserInfo {
  id: string;
  displayName: string;
  /** Login / UPN, e.g. johndoe@contoso.com */
  uniqueName?: string;
  isActive: boolean;
}

export interface Collection {
  id: string;
  name: string;
  /** Full collection URL, e.g. https://navi.united-imaging.com/DH */
  url: string;
  state: string;
}

export interface Project {
  id: string;
  name: string;
  state: string;
  description?: string;
  collectionId: string;
  visibility?: string;
}

export type WorkItemType =
  | 'Epic'
  | 'Feature'
  | 'Product Backlog Item'
  | 'Bug'
  | 'Task'
  | 'Test Case'
  | 'Issue'
  | (string & NonNullable<unknown>);

export interface WorkItem {
  id: number;
  type: WorkItemType;
  title: string;
  state: string;
  assignedTo?: string;
  priority?: number;
  iterationPath?: string;
  areaPath?: string;
  tags?: string;
  // ── Scheduling ──────────────────────────────────────────────────────────────
  effort?: number;
  originalEstimate?: number;
  remainingWork?: number;
  completedWork?: number;
  /** Story points (Scrum / PBI / Bug). */
  storyPoints?: number;
  /** ISO 8601 date strings — only present on work item types that support scheduling dates. */
  startDate?: string;
  finishDate?: string;
  targetDate?: string;
  // ── Common metadata ──────────────────────────────────────────────────────────
  severity?: string;
  activity?: string;
  businessValue?: number;
  valueArea?: string;
  // ── Rich-text fields (populated only in full-detail fetch) ────────────────────
  /** HTML description / acceptance criteria — only populated when item is fetched in full detail. */
  description?: string;
  /** HTML acceptance criteria — only populated when item is fetched in full detail. */
  acceptanceCriteria?: string;
  /** Extra or custom fields requested via extraFields parameter. Key is the ADO reference name. */
  customFields?: Record<string, unknown>;
  /** Parent work item ID (populated when fetched with $expand=relations). */
  parentId?: number;
  /** Parent work item title, populated after batch-fetching related items. */
  parentTitle?: string;
  /** Parent work item type, populated after batch-fetching related items. */
  parentType?: string;
  /** @internal Index of the parent relation in the relations array, used for parent updates. */
  _parentRelationIndex?: number;
  /** Child work items (populated when fetched with $expand=relations). */
  children?: Array<{ id: number; title: string; type: string; state: string; _relationIndex: number }>;
}

/** Metadata about a single ADO field definition. */
export interface WorkItemFieldDef {
  referenceName: string;
  name: string;
  /**
   * ADO field type string as returned by the REST API.
   * Well-known values: 'string' | 'integer' | 'double' | 'dateTime' | 'boolean'
   *   | 'identity' | 'plainText' | 'html' | 'treePath' | 'history'
   *   | 'picklistString' | 'picklistInteger' | 'picklistDouble'
   */
  type: string;
  isCustom?: boolean;
  readOnly?: boolean;
  /** True when ADO reports this is an identity (person) field. */
  isIdentity?: boolean;
  /** True when ADO reports this field has an associated picklist of allowed values. */
  isPicklist?: boolean;
}

export interface WorkItemQuery {
  /** Searches title, tags, and numeric ID. */
  text: string;
  state: string;
  assignee: string;
  /** Stringified priority number: '' | '1' | '2' | '3' | '4' */
  priority: string;
  iterationPath: string;
  areaPath: string;
  /** Single tag filter — items must CONTAIN this tag (case-insensitive). */
  tags: string;
}

// ── Raw ADO response shapes ───────────────────────────────────────────────────

export interface RawCollection {
  id: string;
  name: string;
  url?: string;
  collectionUrl?: string;
  state?: string;
}

export interface RawProject {
  id: string;
  name: string;
  state?: string;
  description?: string;
  visibility?: string;
}

export interface RawWorkItemRef {
  id: number;
  url: string;
}

export interface RawWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
}
