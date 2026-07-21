import React, {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { UserInfo, Collection, Project } from '../api/types';

// ── Domain types ──────────────────────────────────────────────────────────────

export type AppView = 'workItems' | 'sprints' | 'builds' | 'git' | 'tests' | 'releases' | 'editor';

export interface DevOpsConfig {
  serverUrl: string;
  pat: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

export interface DevOpsState {
  config: DevOpsConfig | null;
  currentUser: UserInfo | null;
  collections: Collection[];
  collectionsLoaded: boolean;
  selectedCollectionId: string | null;
  /** Projects keyed by collectionId. */
  projectsByCollection: Record<string, Project[]>;
  selectedProjectId: string | null;
  activeView: AppView;
}

const INITIAL_STATE: DevOpsState = {
  config: null,
  currentUser: null,
  collections: [],
  collectionsLoaded: false,
  selectedCollectionId: null,
  projectsByCollection: {},
  selectedProjectId: null,
  activeView: 'workItems',
};

// ── Actions ───────────────────────────────────────────────────────────────────

export type DevOpsAction =
  | { type: 'LOGIN'; payload: { config: DevOpsConfig; user: UserInfo } }
  | { type: 'LOGOUT' }
  | { type: 'SET_COLLECTIONS'; payload: Collection[] }
  | { type: 'SELECT_COLLECTION'; payload: string }
  | { type: 'SET_PROJECTS'; payload: { collectionId: string; projects: Project[] } }
  | { type: 'SELECT_PROJECT'; payload: string }
  | { type: 'SET_VIEW'; payload: AppView };

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: DevOpsState, action: DevOpsAction): DevOpsState {
  switch (action.type) {
    case 'LOGIN':
      return {
        ...INITIAL_STATE,
        config: action.payload.config,
        currentUser: action.payload.user,
      };
    case 'LOGOUT':
      return INITIAL_STATE;
    case 'SET_COLLECTIONS':
      return { ...state, collections: action.payload, collectionsLoaded: true };
    case 'SELECT_COLLECTION':
      return {
        ...state,
        selectedCollectionId: action.payload,
        selectedProjectId: null,
        activeView: 'workItems',
      };
    case 'SET_PROJECTS':
      return {
        ...state,
        projectsByCollection: {
          ...state.projectsByCollection,
          [action.payload.collectionId]: action.payload.projects,
        },
      };
    case 'SELECT_PROJECT':
      return { ...state, selectedProjectId: action.payload, activeView: 'workItems' };
    case 'SET_VIEW':
      return { ...state, activeView: action.payload };
    default:
      return state;
  }
}

// ── Global refs (accessible outside React for agent tools) ───────────────────

/**
 * A mutable ref that always holds the latest DevOps state and dispatch.
 * Updated synchronously inside DevOpsProvider on every render.
 * Agent tools read/write through this instead of requiring React context.
 */
export const globalDevOps: {
  state: DevOpsState;
  dispatch: Dispatch<DevOpsAction> | null;
} = {
  state: INITIAL_STATE,
  dispatch: null,
};

// ── Context ───────────────────────────────────────────────────────────────────

interface DevOpsContextValue {
  state: DevOpsState;
  dispatch: Dispatch<DevOpsAction>;
}

const DevOpsContext = createContext<DevOpsContextValue | null>(null);

export function DevOpsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  // Keep global ref in sync on every render
  globalDevOps.state = state;
  globalDevOps.dispatch = dispatch;
  return <DevOpsContext.Provider value={{ state, dispatch }}>{children}</DevOpsContext.Provider>;
}

export function useDevOps(): DevOpsContextValue {
  const ctx = useContext(DevOpsContext);
  if (!ctx) throw new Error('useDevOps must be used within DevOpsProvider');
  return ctx;
}

// ── Selectors ─────────────────────────────────────────────────────────────────

export function selectCollection(state: DevOpsState): Collection | null {
  if (!state.selectedCollectionId) return null;
  return state.collections.find((c) => c.id === state.selectedCollectionId) ?? null;
}

export function selectProject(state: DevOpsState): Project | null {
  if (!state.selectedProjectId || !state.selectedCollectionId) return null;
  const projects = state.projectsByCollection[state.selectedCollectionId] ?? [];
  return projects.find((p) => p.id === state.selectedProjectId) ?? null;
}
