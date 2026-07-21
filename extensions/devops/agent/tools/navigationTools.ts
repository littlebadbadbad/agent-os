/** Navigation tools: one-call navigate_to (collection → project → workItems → type → filter). */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DevOpsBridge } from '../types';
import type { Tool } from '@agent-type';

export function createNavigationTools(bridge: DevOpsBridge): Tool[] {
  // ── Helper: wait for React to confirm a dispatch was committed ──────────
  async function waitForCommit(pred: (state: Record<string, unknown>) => boolean, ms = 8_000): Promise<boolean> {
    try {
      await bridge.waitUntil(() => pred(bridge.snapshot('devops.state') as Record<string, unknown>), ms);
      return true;
    } catch {
      return false;
    }
  }

  const devopsNavigateTo = defineTool({
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

      const initial = bridge.snapshot('devops.state') as Record<string, unknown>;
      let expCollId = initial.selectedCollectionId as string | null;
      let expProjId = initial.selectedProjectId as string | null;
      let expView = initial.activeView as string;
      let projectsLoadError: string | null = null;

      // ── Step 1: Collection ────────────────────────────────────────────────────
      if (params.collection) {
        const collections = (initial.collections ?? []) as Array<{ id: string; name: string }>;
        const col =
          collections.find((c) => c.id === params.collection) ??
          collections.find((c) =>
            c.name.toLowerCase().includes(params.collection!.toLowerCase()),
          );
        if (!col) {
          return {
            error: `Collection "${params.collection}" not found. Available: ${collections.map((c) => c.name).join(', ')}。提示：参数名是 collection（不是 collectionId），可传 id 或名称子串。`,
          };
        }

        if (col.id !== expCollId) {
          // CRITICAL: Dispatch directly to the store via bridge
          await bridge.callHandler('devops.dispatch', { type: 'SELECT_COLLECTION', payload: col.id });
          expCollId = col.id;

          // Also try to expand the sidebar for cosmetic consistency (best-effort)
          if (bridge.isRegistered('sidebar.expandCollection')) {
            bridge.callHandler('sidebar.expandCollection', col.id).catch(() => {});
          }

          // Wait for React to commit SELECT_COLLECTION
          const committed = await waitForCommit(
            (state) => (state as Record<string, unknown>).selectedCollectionId === col.id,
          );
          if (!committed) {
            return { error: 'Collection selection timed out — React did not re-render after dispatch.' };
          }

          // Wait for projects to load (non-blocking — graceful timeout)
          const projectsLoaded = await waitForCommit(
            (state) => {
              const projects = (state as Record<string, Record<string, unknown[]>>).projectsByCollection?.[col.id];
              return Array.isArray(projects);
            },
            12_000,
          );
          if (!projectsLoaded) {
            projectsLoadError = `Projects for collection "${col.name}" did not load within timeout (API may be slow or failed). Proceeding without project list.`;
          }

          expProjId = null; // SELECT_COLLECTION reducer resets project
          expView = 'workItems'; // SELECT_COLLECTION reducer resets view
        } else {
          // Collection already selected — ensure projects are loaded
          if (!Array.isArray((initial.projectsByCollection as Record<string, unknown[]>)?.[col.id])) {
            const loaded = await waitForCommit(
              (state) => {
                const projects = (state as Record<string, Record<string, unknown[]>>).projectsByCollection?.[col.id];
                return Array.isArray(projects);
              },
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
        const currentState = bridge.snapshot('devops.state') as Record<string, unknown>;
        const projects = (currentState.projectsByCollection as Record<string, { id: string; name: string }[]>)?.[expCollId] ?? [];
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
          await bridge.callHandler('devops.dispatch', { type: 'SELECT_PROJECT', payload: proj.id });
          expProjId = proj.id;
          expView = 'workItems'; // SELECT_PROJECT reducer resets view
        }
      }

      // ── Step 3: View switch ───────────────────────────────────────────────────
      const targetView = params.view ?? 'workItems';
      if (expView !== targetView) {
        await bridge.callHandler('app.switchView', targetView);
        expView = targetView;
      }

      // ── Step 4: Wait for WorkItemsPage handlers (only if project is selected) ─
      const projectIsReady = expProjId !== null && expCollId !== null;
      if (targetView === 'workItems' && projectIsReady) {
        await bridge.waitUntil(() => bridge.isRegistered('wi.getState'), 10_000, 200);
      }

      // ── Step 5: Type tab (only if project is ready) ──────────────────────────
      if (params.type !== undefined && targetView === 'workItems' && projectIsReady) {
        await bridge.callHandler('wi.setType', params.type);
        // Wait for React to re-render before waiting for loading
        await bridge.waitUntil(() => (bridge.snapshot<{ filter: { activeType: string } }>('wi.getState').filter.activeType === params.type));
        await bridge.waitUntil(() => !bridge.snapshot<{ loadingIds: boolean }>('wi.getState').loadingIds);
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
        await bridge.callHandler('wi.setFilter', filterFields);
        // Wait for filter to actually update in React state before waiting for loading
        await bridge.waitUntil(() => {
          const current = bridge.snapshot<{ filter: Record<string, string> }>('wi.getState').filter;
          return Object.entries(filterFields).every(([k, v]) => current[k] === v);
        });
        await bridge.waitUntil(() => !bridge.snapshot<{ loadingIds: boolean }>('wi.getState').loadingIds);
      }

      // ── Final state read ─────────────────────────────────────────────────────
      const final = bridge.snapshot('devops.state') as Record<string, unknown>;
      const wiState = projectIsReady
        ? bridge.snapshot<{ totalCount: number }>('wi.getState')
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

  const devopsGetAppState = defineTool({
    name: 'devops_get_app_state',
    group: 'DevOps',
    description:
      '返回当前全局应用状态：已登录用户信息（currentUser）、已选 collection/project、当前视图。' +
      '用户信息包含 displayName/id/uniqueName。用于确定"我"是谁、当前在哪个项目中。',
    parameters: z.object({}),
    execute: async () => {
      const s = bridge.snapshot('devops.state') as Record<string, unknown>;
      return {
        currentUser: s.currentUser,
        collectionId: s.selectedCollectionId,
        projectId: s.selectedProjectId,
        activeView: s.activeView,
        loggedIn: s.config !== null,
      };
    },
  });

  return [devopsNavigateTo, devopsGetAppState];
}
