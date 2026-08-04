/**
 * extensions/file/ui/panel/useWorkspaceEditor.ts — Single-workspace editor state
 *
 * Owns the file tree + open tabs + active file for ONE workspace root.
 * One instance of this hook backs one `WorkspaceEditor` — the multi-workspace
 * shell (`useFileWorkspaces`) mounts one such instance per open workspace.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { FileWorkspaceApi, FileTreeNode } from '../api/workspaceApi';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OpenFile {
  /** Workspace-relative path, e.g. "src/index.ts" */
  readonly path: string;
  readonly content: string;
  /** Content at last save (used to detect dirty state). */
  readonly savedContent: string;
}

export interface WorkspaceEditorState {
  readonly fileTree: readonly FileTreeNode[];
  readonly treeLoading: boolean;
  readonly treeError: string | null;
  readonly openFiles: readonly OpenFile[];
  readonly activeFilePath: string | null;
}

export interface WorkspaceEditorActions {
  refreshTree: () => Promise<void>;
  expandDir: (relPath: string) => Promise<readonly FileTreeNode[]>;
  openFile: (relPath: string) => Promise<void>;
  closeFile: (relPath: string) => void;
  setActiveFile: (relPath: string) => void;
  updateContent: (relPath: string, content: string) => void;
  saveFile: (relPath: string) => Promise<void>;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useWorkspaceEditor(
  api: FileWorkspaceApi,
  root: string,
): WorkspaceEditorState & WorkspaceEditorActions {
  const [fileTree, setFileTree] = useState<readonly FileTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<readonly OpenFile[]>([]);
  const [activeFilePath, setActiveFilePathState] = useState<string | null>(null);

  const openFilesRef = useRef<readonly OpenFile[]>(openFiles);
  openFilesRef.current = openFiles;

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const nodes = await api.listDir(root, '', 1);
      setFileTree(nodes);
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreeLoading(false);
    }
  }, [api, root]);

  // Load the tree once when this workspace instance mounts.
  useEffect(() => { loadTree(); }, [loadTree]);

  const refreshTree = useCallback(async () => { await loadTree(); }, [loadTree]);

  const expandDir = useCallback(
    (relPath: string) => api.listDir(root, relPath, 1),
    [api, root],
  );

  const openFile = useCallback(async (relPath: string) => {
    const existing = openFilesRef.current.find((f) => f.path === relPath);
    if (existing) {
      setActiveFilePathState(relPath);
      return;
    }
    const result = await api.readFile(root, relPath);
    const file: OpenFile = { path: relPath, content: result.content, savedContent: result.content };
    setOpenFiles((prev) => [...prev, file]);
    setActiveFilePathState(relPath);
  }, [api, root]);

  const closeFile = useCallback((relPath: string) => {
    setOpenFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === relPath);
      if (idx === -1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      setActiveFilePathState((active) => {
        if (active !== relPath) return active;
        if (next.length === 0) return null;
        return next[Math.max(0, idx - 1)].path;
      });
      return next;
    });
  }, []);

  const setActiveFile = useCallback((relPath: string) => { setActiveFilePathState(relPath); }, []);

  const updateContent = useCallback((relPath: string, content: string) => {
    setOpenFiles((prev) => prev.map((f) => (f.path === relPath ? { ...f, content } : f)));
  }, []);

  const saveFile = useCallback(async (relPath: string) => {
    const file = openFilesRef.current.find((f) => f.path === relPath);
    if (!file) return;
    await api.writeFile(root, relPath, file.content);
    setOpenFiles((prev) => prev.map((f) => (f.path === relPath ? { ...f, savedContent: f.content } : f)));
  }, [api, root]);

  return {
    fileTree, treeLoading, treeError, openFiles, activeFilePath,
    refreshTree, expandDir, openFile, closeFile, setActiveFile, updateContent, saveFile,
  };
}
