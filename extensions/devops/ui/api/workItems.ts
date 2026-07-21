import { adoFetch, WORK_ITEM_FIELDS } from "./client";
import { buildWiql } from "./wiql";
import type { WorkItemApiFilter } from "./wiql";
import type {
  RawWorkItem,
  RawWorkItemRef,
  WorkItem,
  WorkItemFieldDef,
} from "./types";

/** Items fetched per page. */
export const PAGE_SIZE = 100;

// ── Field discovery ───────────────────────────────────────────────────────────

interface RawFieldDef {
  referenceName: string;
  name: string;
  type: string;
  isIdentity?: boolean;
  isPicklist?: boolean;
  readOnly?: boolean;
}

/**
 * List all field definitions for a project (including custom fields).
 * Uses GET /{collection}/{project}/_apis/wit/fields
 */
export async function fetchWorkItemFields(
  collectionUrl: string,
  project: string,
  pat: string,
): Promise<WorkItemFieldDef[]> {
  const encodedProject = encodeURIComponent(project);
  const result = await adoFetch<{ value: RawFieldDef[] }>(
    `${collectionUrl}/${encodedProject}/_apis/wit/fields`,
    pat,
  );
  return (result?.value ?? []).map((f) => ({
    referenceName: f.referenceName,
    name: f.name,
    type: f.type,
    isCustom: f.referenceName.startsWith("Custom."),
    readOnly: f.readOnly,
    isIdentity: f.isIdentity ?? false,
    isPicklist: f.isPicklist ?? false,
  }));
}

/**
 * Fetch allowed values for a specific field in a work item type.
 *
 * ADO endpoint: GET /{collection}/{project}/_apis/wit/workitemtypes/{type}/fields/{ref}
 *   ?$expand=allowedValues
 *
 * Returns an empty array when the field has no restricted allowed-value list
 * (i.e. the field is free-form).
 */
export async function fetchFieldAllowedValues(
  collectionUrl: string,
  project: string,
  pat: string,
  workItemType: string,
  fieldRef: string,
): Promise<string[]> {
  const encodedProject = encodeURIComponent(project);
  const encodedType = encodeURIComponent(workItemType);
  const encodedRef  = encodeURIComponent(fieldRef);
  try {
    const data = await adoFetch<{ allowedValues?: unknown[] }>(
      `${collectionUrl}/${encodedProject}/_apis/wit/workitemtypes/${encodedType}/fields/${encodedRef}?$expand=allowedValues`,
      pat,
      { apiVersion: '6.1-preview.3' },
    );
    const raw = data?.allowedValues ?? [];
    return raw.map((v) => (v != null ? String(v) : '')).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Work-item queries ─────────────────────────────────────────────────────────

/** Result of a capped WIQL ID query. */
export interface WorkItemIdPage {
  /** Ordered IDs for this result set (up to `cap` items). */
  ids: number[];
  /**
   * True when the number of matching items exceeds `cap`.
   * The real total is unknown — display as "N+" in the UI.
   */
  isCapped: boolean;
  /** The cap that was applied. */
  cap: number;
}

/**
 * POST WIQL with optional filter conditions — returns matching work item IDs,
 * ordered by ChangedDate DESC, capped at `top` (default 500).
 *
 * ADO WIQL has no OFFSET or COUNT(*), so we use $top to avoid fetching
 * tens-of-thousands of IDs on large projects. When `isCapped` is true
 * the caller should offer a "load more / expand limit" action.
 */
export async function fetchFilteredWorkItemIds(
  collectionUrl: string,
  project: string,
  pat: string,
  filter: WorkItemApiFilter,
  top = 500,
): Promise<WorkItemIdPage> {
  const encodedProject = encodeURIComponent(project);
  const refs = await adoFetch<{ workItems: RawWorkItemRef[] }>(
    `${collectionUrl}/${encodedProject}/_apis/wit/wiql?$top=${top + 1}`,
    pat,
    { method: "POST", body: { query: buildWiql(project, filter) }, apiVersion: "6.1-preview.2" },
  );
  const all = (refs?.workItems ?? []).map((r) => r.id);
  const isCapped = all.length > top;
  return { ids: isCapped ? all.slice(0, top) : all, isCapped, cap: top };
}

/**
 * Fetch full field details for a given list of IDs.
 * IDs are batched into groups of 200 (API hard limit) and fetched serially.
 * Pass `extraFields` to request additional field reference names beyond the defaults
 * (e.g. custom fields like "Custom.MyField"). Extra field values are returned in
 * each WorkItem's `customFields` map.
 */
export async function fetchWorkItemDetails(
  collectionUrl: string,
  pat: string,
  ids: number[],
  extraFields: string[] = [],
): Promise<WorkItem[]> {
  if (ids.length === 0) return [];

  const allFields =
    extraFields.length > 0
      ? [...WORK_ITEM_FIELDS, ...extraFields]
      : WORK_ITEM_FIELDS;
  const fieldParam = allFields.join(",");
  const rawItems: RawWorkItem[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const result = await adoFetch<{ value: RawWorkItem[] }>(
      `${collectionUrl}/_apis/wit/workitems?ids=${batch.join(",")}&fields=${fieldParam}`,
      pat,
      { apiVersion: "6.1-preview.3" },
    );
    rawItems.push(...(result?.value ?? []));
  }

  return rawItems.map((wi) => mapRawWorkItem(wi, extraFields));
}

// ── Raw → domain mapper ───────────────────────────────────────────────────────

function parseParentFromRelations(
  relations: RawWorkItem['relations'],
): { parentId?: number; _parentRelationIndex?: number } {
  if (!relations) return {};
  const PARENT_REL = 'System.LinkTypes.Hierarchy-Reverse';
  const idx = relations.findIndex((r) => r.rel === PARENT_REL);
  if (idx === -1) return {};
  const url = relations[idx].url;
  const lastSegment = url.split('/').pop();
  const parentId = lastSegment ? parseInt(lastSegment, 10) : NaN;
  if (isNaN(parentId)) return {};
  return { parentId, _parentRelationIndex: idx };
}

// ── Field extraction helpers ──────────────────────────────────────────────────

const toNum = (v: unknown): number | undefined => (v != null ? Number(v) : undefined);
const toStr = (v: unknown): string | undefined => (v != null ? String(v) : undefined);

function mapRawWorkItem(wi: RawWorkItem, extraFields: string[] = []): WorkItem {
  const f = wi.fields;
  const assignedRaw = f["System.AssignedTo"];
  const assignedTo =
    assignedRaw && typeof assignedRaw === "object"
      ? (assignedRaw as { displayName?: string }).displayName
      : typeof assignedRaw === "string"
        ? assignedRaw
        : undefined;

  const item: WorkItem = {
    id: wi.id,
    type:  String(f["System.WorkItemType"] ?? ""),
    title: String(f["System.Title"] ?? ""),
    state: String(f["System.State"] ?? ""),
    assignedTo,
    // Common
    priority:      toNum(f["Microsoft.VSTS.Common.Priority"]),
    severity:      toStr(f["Microsoft.VSTS.Common.Severity"]),
    activity:      toStr(f["Microsoft.VSTS.Common.Activity"]),
    businessValue: toNum(f["Microsoft.VSTS.Common.BusinessValue"]),
    valueArea:     toStr(f["Microsoft.VSTS.Common.ValueArea"]),
    // System paths / tags
    iterationPath: toStr(f["System.IterationPath"]),
    areaPath:      toStr(f["System.AreaPath"]),
    tags:          toStr(f["System.Tags"]),
    // Scheduling
    effort:           toNum(f["Microsoft.VSTS.Scheduling.Effort"]),
    originalEstimate: toNum(f["Microsoft.VSTS.Scheduling.OriginalEstimate"]),
    remainingWork:    toNum(f["Microsoft.VSTS.Scheduling.RemainingWork"]),
    completedWork:    toNum(f["Microsoft.VSTS.Scheduling.CompletedWork"]),
    storyPoints:      toNum(f["Microsoft.VSTS.Scheduling.StoryPoints"]),
    startDate:        toStr(f["Microsoft.VSTS.Scheduling.StartDate"]),
    finishDate:       toStr(f["Microsoft.VSTS.Scheduling.FinishDate"]),
    targetDate:       toStr(f["Microsoft.VSTS.Scheduling.TargetDate"]),
    // Rich-text (only present in full-detail fetch)
    description:        toStr(f["System.Description"]),
    acceptanceCriteria: toStr(f["Microsoft.VSTS.Common.AcceptanceCriteria"]),
  };

  // Parse parent relation
  if (wi.relations) {
    const { parentId, _parentRelationIndex } = parseParentFromRelations(wi.relations);
    if (parentId !== undefined) {
      item.parentId = parentId;
      item._parentRelationIndex = _parentRelationIndex;
    }
  }

  if (extraFields.length > 0) {
    const customFields: Record<string, unknown> = {};
    for (const ref of extraFields) {
      if (f[ref] !== undefined) {
        const val = f[ref];
        // ADO identity fields always return an object with displayName even when
        // the field type is declared as "string" with isIdentity:true.
        // Normalize to displayName string to avoid "[Object Object]" in the UI.
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          const identity = val as { displayName?: string; uniqueName?: string };
          customFields[ref] = identity.displayName ?? identity.uniqueName ?? '';
        } else {
          customFields[ref] = val;
        }
      }
    }
    if (Object.keys(customFields).length > 0) {
      item.customFields = customFields;
    }
  }

  return item;
}

// ── Standard field reference names ───────────────────────────────────

const STANDARD_FIELD_REFS = new Set([
  ...WORK_ITEM_FIELDS,
  // Rich-text fields fetched only in full-detail view (not in batch WORK_ITEM_FIELDS)
  "Microsoft.VSTS.Common.AcceptanceCriteria",
  "System.Description",
  // Audit / system-managed fields (read-only, never edited)
  "System.Id",
  "System.Rev",
  "System.AreaId",
  "System.IterationId",
  "System.TeamProject",
  "System.NodeName",
  "System.AuthorizedAs",
  "System.AuthorizedDate",
  "System.RevisedDate",
  "System.PersonId",
  "System.Watermark",
  "System.AttachedFileCount",
  "System.HyperLinkCount",
  "System.ExternalLinkCount",
  "System.RelatedLinkCount",
  "System.ChangedBy",
  "System.ChangedDate",
  "System.CreatedBy",
  "System.CreatedDate",
]);

/**
 * Fetch all fields for a single work item (no ?fields= filter).
 * Non-standard fields are placed in WorkItem.customFields.
 * System.Description is mapped to WorkItem.description.
 */
/**
 * Search work items by title keyword (for parent-picker autocomplete).
 * Returns lightweight objects with id, title, and type.
 */
export async function searchWorkItemsByTitle(
  collectionUrl: string,
  project: string,
  pat: string,
  text: string,
  top = 20,
): Promise<Array<{ id: number; title: string; type: string }>> {
  if (!text.trim()) return [];
  const wiql = buildWiql(project, {
    workItemType: '',
    text: text.trim(),
    state: '',
    assignee: '',
    priority: '',
    iterationPath: '',
    areaPath: '',
    tags: '',
  });
  const encodedProject = encodeURIComponent(project);
  const refs = await adoFetch<{ workItems: Array<{ id: number }> }>(
    `${collectionUrl}/${encodedProject}/_apis/wit/wiql?$top=${top}`,
    pat,
    { method: 'POST', body: { query: wiql }, apiVersion: '6.1-preview.2' },
  );
  const ids = (refs?.workItems ?? []).map((r) => r.id);
  if (ids.length === 0) return [];
  const result = await adoFetch<{ value: RawWorkItem[] }>(
    `${collectionUrl}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.WorkItemType`,
    pat,
    { apiVersion: '6.1-preview.3' },
  );
  return (result?.value ?? []).map((wi) => ({
    id: wi.id,
    title: String(wi.fields['System.Title'] ?? ''),
    type: String(wi.fields['System.WorkItemType'] ?? ''),
  }));
}

export async function fetchSingleWorkItemFull(
  collectionUrl: string,
  pat: string,
  id: number,
): Promise<WorkItem> {
  const raw = await adoFetch<RawWorkItem>(
    `${collectionUrl}/_apis/wit/workitems/${id}?$expand=relations`,
    pat,
    { apiVersion: "6.1-preview.3" },
  );
  const extraFieldRefs = Object.keys(raw.fields).filter(
    (k) => !STANDARD_FIELD_REFS.has(k),
  );
  const item = mapRawWorkItem(raw, extraFieldRefs);

  // Parse child relations (Hierarchy-Forward)
  const CHILD_REL = 'System.LinkTypes.Hierarchy-Forward';
  const childEntries = (raw.relations ?? [])
    .map((r, idx) => ({ ...r, idx }))
    .filter((r) => r.rel === CHILD_REL)
    .map((r) => {
      const lastSeg = r.url.split('/').pop();
      const childId = lastSeg ? parseInt(lastSeg, 10) : NaN;
      return { childId, relationIndex: r.idx };
    })
    .filter((e) => !isNaN(e.childId));

  // Batch-fetch parent title + children titles/types/states in one request
  const idsToFetch = [
    ...(item.parentId != null ? [item.parentId] : []),
    ...childEntries.map((e) => e.childId),
  ];

  if (idsToFetch.length > 0) {
    try {
      const related = await adoFetch<{ value: RawWorkItem[] }>(
        `${collectionUrl}/_apis/wit/workitems?ids=${idsToFetch.join(',')}&fields=System.Id,System.Title,System.WorkItemType,System.State`,
        pat,
        { apiVersion: '6.1-preview.3' },
      );
      const relatedMap = new Map((related?.value ?? []).map((wi) => [wi.id, wi]));

      if (item.parentId != null) {
        const pw = relatedMap.get(item.parentId);
        if (pw) {
          item.parentTitle = String(pw.fields['System.Title'] ?? '');
          item.parentType  = String(pw.fields['System.WorkItemType'] ?? '');
        }
      }

      if (childEntries.length > 0) {
        item.children = childEntries.map((e) => {
          const cw = relatedMap.get(e.childId);
          return {
            id:             e.childId,
            title:          cw ? String(cw.fields['System.Title'] ?? '') : `#${e.childId}`,
            type:           cw ? String(cw.fields['System.WorkItemType'] ?? '') : '',
            state:          cw ? String(cw.fields['System.State'] ?? '') : '',
            _relationIndex: e.relationIndex,
          };
        });
      }
    } catch {
      // Non-fatal: related items may be inaccessible; proceed without titles
    }
  }

  return item;
}

// ── Work-item update ──────────────────────────────────────────────

/** Fields that can be edited and PATCH-ed back to ADO. */
export interface WorkItemPatch {
  title?: string;
  state?: string;
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
  storyPoints?: number;
  startDate?: string;
  finishDate?: string;
  targetDate?: string;
  // ── Common metadata ──────────────────────────────────────────────────────────
  severity?: string;
  activity?: string;
  businessValue?: number;
  valueArea?: string;
  // ── Rich-text ─────────────────────────────────────────────────────────────────
  description?: string;
  acceptanceCriteria?: string;
  /** Additional / custom fields. Key is the ADO field reference name. */
  customFields?: Record<string, unknown>;
  /** Set to a work item ID to assign a parent relationship. */
  parentId?: number | null;
  /** @internal Index of the existing parent relation to remove when changing parent. */
  _currentParentRelationIndex?: number;
  /** Work item IDs to add as children. */
  childrenToAdd?: number[];
  /** Children to unlink (each carries the relation array index for the PATCH remove op). */
  childrenToRemove?: Array<{ id: number; relationIndex: number }>;
}

/** Pair of (WorkItemPatch key) → ADO field reference name. */
const PATCH_FIELD_MAP: Array<[keyof WorkItemPatch, string]> = [
  ["title", "System.Title"],
  ["state", "System.State"],
  ["assignedTo", "System.AssignedTo"],
  ["priority", "Microsoft.VSTS.Common.Priority"],
  ["iterationPath", "System.IterationPath"],
  ["areaPath", "System.AreaPath"],
  ["tags", "System.Tags"],
  // Scheduling
  ["effort",           "Microsoft.VSTS.Scheduling.Effort"],
  ["originalEstimate", "Microsoft.VSTS.Scheduling.OriginalEstimate"],
  ["remainingWork",    "Microsoft.VSTS.Scheduling.RemainingWork"],
  ["completedWork",    "Microsoft.VSTS.Scheduling.CompletedWork"],
  ["storyPoints",      "Microsoft.VSTS.Scheduling.StoryPoints"],
  ["startDate",        "Microsoft.VSTS.Scheduling.StartDate"],
  ["finishDate",       "Microsoft.VSTS.Scheduling.FinishDate"],
  ["targetDate",       "Microsoft.VSTS.Scheduling.TargetDate"],
  // Common
  ["severity",         "Microsoft.VSTS.Common.Severity"],
  ["activity",         "Microsoft.VSTS.Common.Activity"],
  ["businessValue",    "Microsoft.VSTS.Common.BusinessValue"],
  ["valueArea",        "Microsoft.VSTS.Common.ValueArea"],
  // Rich-text
  ["description",        "System.Description"],
  ["acceptanceCriteria", "Microsoft.VSTS.Common.AcceptanceCriteria"],
];

/**
 * PATCH a work item using the ADO JSON-patch protocol.
 * Only fields present in `patch` are sent.
 */
export async function updateWorkItem(
  collectionUrl: string,
  project: string,
  pat: string,
  id: number,
  patch: WorkItemPatch,
): Promise<void> {
  const ops: Array<{ op: string; path: string; value: unknown }> =
    PATCH_FIELD_MAP.filter(([key]) => patch[key] !== undefined).map(
      ([key, field]) => ({
        op: "add",
        path: `/fields/${field}`,
        value: patch[key],
      }),
    );

  // Custom fields
  if (patch.customFields) {
    for (const [ref, value] of Object.entries(patch.customFields)) {
      ops.push({ op: "add", path: `/fields/${ref}`, value });
    }
  }

  // Relation removals — collect all indices and apply in descending order so
  // earlier removes don't shift later indices.
  const removalIndices: number[] = [];
  if (patch.parentId !== undefined && patch._currentParentRelationIndex !== undefined) {
    removalIndices.push(patch._currentParentRelationIndex);
  }
  if (patch.childrenToRemove) {
    for (const c of patch.childrenToRemove) removalIndices.push(c.relationIndex);
  }
  if (removalIndices.length > 0) {
    const removeOps = [...new Set(removalIndices)]
      .sort((a, b) => b - a)
      .map((idx) => ({ op: "remove", path: `/relations/${idx}`, value: null }));
    ops.unshift(...removeOps);
  }

  // Add new parent relation
  if (patch.parentId != null) {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `${collectionUrl}/_apis/wit/workitems/${patch.parentId}`,
        attributes: {},
      },
    });
  }

  // Add new child relations
  if (patch.childrenToAdd) {
    for (const childId of patch.childrenToAdd) {
      ops.push({
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Hierarchy-Forward",
          url: `${collectionUrl}/_apis/wit/workitems/${childId}`,
          attributes: {},
        },
      });
    }
  }

  if (ops.length === 0) return;

  const encodedProject = encodeURIComponent(project);
  await adoFetch<RawWorkItem>(
    `${collectionUrl}/${encodedProject}/_apis/wit/workitems/${id}`,
    pat,
    { method: "PATCH", body: ops, contentType: "application/json-patch+json", apiVersion: "6.1-preview.3" },
  );
}

/**
 * Create a new work item of the given type.
 * Returns the created work item with its server-assigned ID.
 */
export async function createWorkItem(
  collectionUrl: string,
  project: string,
  pat: string,
  type: string,
  fields: WorkItemPatch & { title: string },
): Promise<WorkItem> {
  const ops: Array<{ op: string; path: string; value: unknown }> =
    PATCH_FIELD_MAP.filter(
      ([key]) => (fields as WorkItemPatch)[key] !== undefined,
    ).map(([key, field]) => ({
      op: "add",
      path: `/fields/${field}`,
      value: (fields as WorkItemPatch)[key],
    }));

  // Custom fields
  if (fields.customFields) {
    for (const [ref, value] of Object.entries(fields.customFields)) {
      if (value != null) ops.push({ op: "add", path: `/fields/${ref}`, value });
    }
  }

  // Parent relation
  if (fields.parentId) {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `${collectionUrl}/_apis/wit/workitems/${fields.parentId}`,
        attributes: {},
      },
    });
  }

  const encodedProject = encodeURIComponent(project);
  const raw = await adoFetch<RawWorkItem>(
    `${collectionUrl}/${encodedProject}/_apis/wit/workitems/$${encodeURIComponent(type)}`,
    pat,
    { method: "POST", body: ops, contentType: "application/json-patch+json", apiVersion: "6.1-preview.3" },
  );
  return mapRawWorkItem(raw);
}
