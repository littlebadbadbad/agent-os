import type { WorkItemQuery } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** All conditions that get compiled into a WIQL WHERE clause. */
export interface WorkItemApiFilter {
  /** Work item type tab selection. Empty string means all types. */
  workItemType: string;
  /** Free-text: title CONTAINS search, or exact `#ID` numeric match. */
  text: string;
  state: string;
  assignee: string;
  /** Stringified priority: '' | '1' | '2' | '3' | '4'. */
  priority: string;
  iterationPath: string;
  areaPath: string;
  /** Single tag filter — uses WIQL CONTAINS. Empty string means no filter. */
  tags: string;
}

/** Convenience constant: no filter conditions applied (returns all items). */
export const EMPTY_FILTER: WorkItemApiFilter = {
  workItemType: '',
  text: '',
  state: '',
  assignee: '',
  priority: '',
  iterationPath: '',
  areaPath: '',
  tags: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map UI-level WorkItemQuery + type tab into a WorkItemApiFilter. */
export function composeFilter(workItemType: string, query: WorkItemQuery): WorkItemApiFilter {
  return {
    workItemType,
    text: query.text,
    state: query.state,
    assignee: query.assignee,
    priority: query.priority,
    iterationPath: query.iterationPath,
    areaPath: query.areaPath,
    tags: query.tags ?? '',
  };
}

/** Escape single-quote characters for WIQL string literals. */
function escapeWiql(s: string): string {
  return s.replace(/'/g, "''");
}

// ── Query builder ─────────────────────────────────────────────────────────────

/** Build a full WIQL SELECT statement from a filter object. */
export function buildWiql(project: string, filter: WorkItemApiFilter): string {
  const conds: string[] = [`[System.TeamProject] = '${escapeWiql(project)}'`];

  if (filter.workItemType) {
    conds.push(`[System.WorkItemType] = '${escapeWiql(filter.workItemType)}'`);
  }
  if (filter.state) {
    conds.push(`[System.State] = '${escapeWiql(filter.state)}'`);
  }
  if (filter.assignee) {
    conds.push(`[System.AssignedTo] = '${escapeWiql(filter.assignee)}'`);
  }
  if (filter.priority) {
    conds.push(`[Microsoft.VSTS.Common.Priority] = ${Number(filter.priority)}`);
  }
  if (filter.iterationPath) {
    conds.push(`[System.IterationPath] UNDER '${escapeWiql(filter.iterationPath)}'`);
  }
  if (filter.areaPath) {
    conds.push(`[System.AreaPath] UNDER '${escapeWiql(filter.areaPath)}'`);
  }
  if (filter.tags) {
    conds.push(`[System.Tags] CONTAINS '${escapeWiql(filter.tags)}'`);
  }
  if (filter.text) {
    const trimmed = filter.text.replace(/^#/, '').trim();
    const asId = parseInt(trimmed, 10);
    if (!isNaN(asId) && String(asId) === trimmed) {
      conds.push(`[System.Id] = ${asId}`);
    } else {
      conds.push(`[System.Title] CONTAINS '${escapeWiql(filter.text)}'`);
    }
  }

  return (
    `SELECT [System.Id] FROM WorkItems WHERE ${conds.join(' AND ')} ` +
    `ORDER BY [System.ChangedDate] DESC`
  );
}
