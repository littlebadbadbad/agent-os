/**
 * extensions/file/ui/panel/useFileWorkspaces.ts — Multi-workspace manager
 *
 * Tracks the set of workspace folders currently open in the file panel
 * (persisted in localStorage so they survive re-opening the app window),
 * plus the workspace root the agent's `set_workspace_root` tool currently
 * targets — so the panel can highlight it and jump straight to it.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { FileWorkspaceApi } from '../api/workspaceApi';

const STORAGE_KEY = 'uap.file-plugin.open-workspaces';

export interface WorkspaceTab {
  readonly root: string;
  readonly label: string;
}

function labelFor(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || trimmed;
}

function loadPersistedRoots(): readonly string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function persistRoots(roots: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roots));
  } catch {
    // localStorage unavailable (e.g. private browsing) — open workspaces just won't persist.
  }
}

export interface FileWorkspacesState {
  readonly workspaces: readonly WorkspaceTab[];
  readonly activeRoot: string | null;
  readonly agentRoot: string | null;
  readonly opening: boolean;
  readonly error: string | null;
}

export interface FileWorkspacesActions {
  addWorkspace: (absPath: string) => Promise<void>;
  closeWorkspace: (root: string) => void;
  setActive: (root: string) => void;
  jumpToAgentWorkspace: () => Promise<void>;
  refreshAgentWorkspace: () => Promise<void>;
  dismissError: () => void;
}

export function useFileWorkspaces(api: FileWorkspaceApi): FileWorkspacesState & FileWorkspacesActions {
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceTab[]>(() =>
    loadPersistedRoots().map((root) => ({ root, label: labelFor(root) })),
  );
  const [activeRoot, setActiveRoot] = useState<string | null>(() => workspaces[0]?.root ?? null);
  const [agentRoot, setAgentRoot] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;

  useEffect(() => { persistRoots(workspaces.map((w) => w.root)); }, [workspaces]);

  const refreshAgentWorkspace = useCallback(async () => {
    try {
      const result = await api.getAgentWorkspace();
      setAgentRoot(result.root || null);
    } catch {
      setAgentRoot(null);
    }
  }, [api]);

  // Refresh on mount, then whenever the app window regains focus/visibility —
  // avoids constant polling while keeping the indicator reasonably fresh.
  useEffect(() => {
    refreshAgentWorkspace();
    const onFocusChange = () => { refreshAgentWorkspace(); };
    window.addEventListener('focus', onFocusChange);
    document.addEventListener('visibilitychange', onFocusChange);
    return () => {
      window.removeEventListener('focus', onFocusChange);
      document.removeEventListener('visibilitychange', onFocusChange);
    };
  }, [refreshAgentWorkspace]);

  const addWorkspace = useCallback(async (absPath: string) => {
    setOpening(true);
    setError(null);
    try {
      const result = await api.openWorkspace(absPath);
      setWorkspaces((prev) =>
        prev.some((w) => w.root === result.root)
          ? prev
          : [...prev, { root: result.root, label: labelFor(result.root) }],
      );
      setActiveRoot(result.root);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  }, [api]);

  const closeWorkspace = useCallback((root: string) => {
    setWorkspaces((prev) => {
      const idx = prev.findIndex((w) => w.root === root);
      if (idx === -1) return prev;
      const next = prev.filter((w) => w.root !== root);
      setActiveRoot((current) => {
        if (current !== root) return current;
        if (next.length === 0) return null;
        return next[Math.max(0, idx - 1)].root;
      });
      return next;
    });
  }, []);

  const setActive = useCallback((root: string) => { setActiveRoot(root); }, []);

  const jumpToAgentWorkspace = useCallback(async () => {
    if (!agentRoot) return;
    if (workspacesRef.current.some((w) => w.root === agentRoot)) {
      setActiveRoot(agentRoot);
      return;
    }
    await addWorkspace(agentRoot);
  }, [agentRoot, addWorkspace]);

  const dismissError = useCallback(() => { setError(null); }, []);

  return {
    workspaces, activeRoot, agentRoot, opening, error,
    addWorkspace, closeWorkspace, setActive, jumpToAgentWorkspace, refreshAgentWorkspace, dismissError,
  };
}
