/** Navigation tools: one-call navigate_to (collection → project → workItems → type → filter). */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { bridgeCall, bridgeSnap, waitForWorkItemHandlers } from './helpers';
import { uiBridge } from './uiBridge';
import { globalDevOps } from '../store/devopsStore';
import type { AppView } from '../store/devopsStore';

export const devopsNavigateTo = defineTool({
  name: 'devops_navigate_to',
  group: 'DevOps',
  description:
    'One-call navigation: select collection → project → view → set type + filter. ' +
    'All params optional. Skips already-selected items. Returns final state.\n' +
    '⚠️ 参数名是 collection/project（不是 collectionId/projectId），但值可以传 id 或名称子串。',
  parameters: z.object({
    collection: z.string().optional().describe('Collection id or name substring.'),
    project: z.string().optional().describe('Project id or name substring.'),
    view: z.enum(['workItems', 'sprints', 'builds', 'git', 'tests', 'releases']).optional().describe('Target view.'),
    type: z.string().optional().describe('Work item type tab name (exact from types[].name).'),
    text: z.string().optional().describe('Free-text search (title or #ID).'),
    state: z.string().optional().describe('State name (exact). Use "" to clear.'),
    assignee: z.string().optional().describe('DisplayName from members. Use "" to clear.'),
    priority: z.enum(['', '1', '2', '3', '4']).optional().describe('""=all, "1"=critical ~ "4"=low.'),
    iterationPath: z.string().optional().describe('Exact iteration path. Use "" to clear.'),
    areaPath: z.string().optional().describe('Exact area path. Use "" to clear.'),
    tags: z.string().optional().describe('Single tag name from tagOptions. Use "" to clear.'),
  }),
  execute: async (params) => {
    // ── Guard: detect likely wrong param names (common LLM mistake) ─────────
    const knownKeys = new Set(['collection', 'project', 'view', 'type', 'text', 'state', 'assignee', 'priority', 'iterationPath', 'areaPath', 'tags']);
    const unknownKeys = Object.keys(params).filter((k) => !knownKeys.has(k));
    if (unknownKeys.length > 0) {
      return {
        error: `navigate_to 不支持参数: ${unknownKeys.join(', ')}。参数名是 collection/project（不是 collectionId/collectionName/projectId/projectName）。已知参数: ${[...knownKeys].join(', ')}`,
      };
    }

    const initial = globalDevOps.state;
    let expCollId = initial.selectedCollectionId;
    let expProjId = initial.selectedProjectId;
    let expView = initial.activeView;
    let projectsLoadError: string | null = null;

    // ── Helper: wait for React to confirm a dispatch was committed ──────────
    // After dispatch(), globalDevOps.state is stale until React re-renders.
    // We wait until a predicate on globalDevOps.state becomes true, with a
    // short timeout.
    async function waitForCommit(pred: () => boolean, label: string, ms = 8_000): Promise<boolean> {
      try {
        await uiBridge.waitUntil(pred, ms);
        return true;
      } catch {
        return false;
      }
    }

    // ── Step 1: Collection ────────────────────────────────────────────────────
    if (params.collection) {
      const col =
        initial.collections.find((c) => c.id === params.collection) ??
        initial.collections.find((c) =>
          c.name.toLowerCase().includes(params.collection!.toLowerCase()),
        );
      if (!col) {
        return {
          error: `Collection "${params.collection}" not found. Available: ${initial.collections.map((c) => c.name).join(', ')}。提示：参数名是 collection（不是 collectionId），可传 id 或名称子串。`,
        };
      }

      if (col.id !== expCollId) {
        // CRITICAL: Dispatch directly to the store instead of going through
        // 'sidebar.expandCollection' bridge — Sidebar component may not be
        // mounted (e.g. if view === 'editor'), causing the bridge call to fail.
        // Direct dispatch is always available via globalDevOps.dispatch.
        globalDevOps.dispatch!({ type: 'SELECT_COLLECTION', payload: col.id });
        expCollId = col.id;

        // Also try to expand the sidebar for cosmetic consistency (best-effort)
        if (uiBridge.isRegistered('sidebar.expandCollection')) {
          bridgeCall('sidebar.expandCollection', col.id).catch(() => {});
        }

        // Wait for React to commit SELECT_COLLECTION
        const committed = await waitForCommit(
          () => globalDevOps.state.selectedCollectionId === col.id,
          'SELECT_COLLECTION',
        );
        if (!committed) {
          return { error: 'Collection selection timed out — React did not re-render after dispatch.' };
        }

        // Wait for projects to load (non-blocking — graceful timeout)
        const projectsLoaded = await waitForCommit(
          () => Array.isArray(globalDevOps.state.projectsByCollection[col.id]),
          'SET_PROJECTS',
          12_000,
        );
        if (!projectsLoaded) {
          projectsLoadError = `Projects for collection "${col.name}" did not load within timeout (API may be slow or failed). Proceeding without project list.`;
        }

        expProjId = null; // SELECT_COLLECTION reducer resets project
        expView = 'workItems'; // SELECT_COLLECTION reducer resets view
      } else {
        // Collection already selected — ensure projects are loaded
        if (!Array.isArray(initial.projectsByCollection[col.id])) {
          const loaded = await waitForCommit(
            () => Array.isArray(globalDevOps.state.projectsByCollection[col.id]),
            'SET_PROJECTS (already selected)',
            12_000,
          );
          if (!loaded) {
            projectsLoadError = `Projects for collection "${col.name}" not loaded. API may be slow or failed.`;
          }
        }
      }
    }

    // ── Step 2: Project ───────────────────────────────────────────────────────
    if (params.project) {
      if (!expCollId) return { error: 'No collection selected. Provide collection or select one first.' };
      const projects = globalDevOps.state.projectsByCollection[expCollId] ?? [];
      const proj =
        projects.find((p) => p.id === params.project) ??
        projects.find((p) =>
          p.name.toLowerCase().includes(params.project!.toLowerCase()),
        );
      if (!proj) {
        const avail = projects.length > 0
          ? `Available: ${projects.map((p) => p.name).join(', ')}`
          : 'No projects loaded. Check collection or API availability.';
        return { error: `Project "${params.project}" not found in current collection. ${avail}` };
      }
      if (proj.id !== expProjId) {
        globalDevOps.dispatch!({ type: 'SELECT_PROJECT', payload: proj.id });
        expProjId = proj.id;
        expView = 'workItems'; // SELECT_PROJECT reducer resets view
      }
    }

    // ── Step 3: View switch ───────────────────────────────────────────────────
    const targetView = params.view ?? 'workItems';
    if (expView !== targetView) {
      await bridgeCall('app.switchView', targetView as AppView);
      expView = targetView;
    }

    // ── Step 4: Wait for WorkItemsPage handlers (only if project is selected) ─
    const projectIsReady = expProjId !== null && expCollId !== null;
    if (targetView === 'workItems' && projectIsReady) {
      await waitForWorkItemHandlers();
    }

    // ── Step 5: Type tab (only if project is ready) ──────────────────────────
    if (params.type !== undefined && targetView === 'workItems' && projectIsReady) {
      await bridgeCall('wi.setType', params.type);
      // Wait for React to re-render before waiting for loading
      await uiBridge.waitUntil(() => bridgeSnap<{ filter: { activeType: string } }>('wi.getState').filter.activeType === params.type);
      await uiBridge.waitUntil(() => !bridgeSnap<{ loadingIds: boolean }>('wi.getState').loadingIds);
    }

    // ── Step 6: Filters (only if project is ready) ───────────────────────────
    const filterFields: Record<string, string | undefined> = {};
    if (params.text !== undefined) filterFields.text = params.text;
    if (params.state !== undefined) filterFields.state = params.state;
    if (params.assignee !== undefined) filterFields.assignee = params.assignee;
    if (params.priority !== undefined) filterFields.priority = params.priority;
    if (params.iterationPath !== undefined) filterFields.iterationPath = params.iterationPath;
    if (params.areaPath !== undefined) filterFields.areaPath = params.areaPath;
    if (params.tags !== undefined) filterFields.tags = params.tags;
    if (Object.keys(filterFields).length > 0 && targetView === 'workItems' && projectIsReady) {
      await bridgeCall('wi.setFilter', filterFields);
      // Wait for filter to actually update in React state before waiting for loading
      await uiBridge.waitUntil(() => {
        const current = bridgeSnap<{ filter: Record<string, string> }>('wi.getState').filter;
        return Object.entries(filterFields).every(([k, v]) => current[k] === v);
      });
      await uiBridge.waitUntil(() => !bridgeSnap<{ loadingIds: boolean }>('wi.getState').loadingIds);
    }

    // ── Final state read ─────────────────────────────────────────────────────
    const final = globalDevOps.state;
    const wiState = projectIsReady
      ? bridgeSnap<{ totalCount: number }>('wi.getState')
      : { totalCount: 0 };
    const needsProject = params.project === undefined &&
      (params.type !== undefined || params.text !== undefined || params.state !== undefined ||
       params.assignee !== undefined || params.priority !== undefined ||
       params.iterationPath !== undefined || params.areaPath !== undefined || params.tags !== undefined);
    return {
      collectionId: final.selectedCollectionId,
      projectId: final.selectedProjectId,
      activeView: final.activeView,
      projectMissing: !projectIsReady,
      filterApplied: projectIsReady && (params.type !== undefined || Object.keys(filterFields).length > 0),
      totalCount: wiState.totalCount,
      ...(projectsLoadError ? { warning: projectsLoadError } : {}),
      ...(needsProject && !projectIsReady
        ? { hint: '请先选择项目: navigate_to({collection:"...", project:"..."}) 后再执行筛选（参数名是 collection/project，不是 collectionId/projectId）。' }
        : {}),
    };
  },
});

export const devopsGetAppState = defineTool({
  name: 'devops_get_app_state',
  group: 'DevOps',
  description:
    '返回当前全局应用状态：已登录用户信息（currentUser）、已选 collection/project、当前视图。' +
    '用户信息包含 displayName/id/uniqueName。用于确定"我"是谁、当前在哪个项目中。',
  parameters: z.object({}),
  execute: async () => {
    const s = globalDevOps.state;
    return {
      currentUser: s.currentUser,
      collectionId: s.selectedCollectionId,
      projectId: s.selectedProjectId,
      activeView: s.activeView,
      loggedIn: s.config !== null,
    };
  },
});
