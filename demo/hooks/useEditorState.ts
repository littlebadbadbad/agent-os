import { useState, useCallback, useRef } from 'react';
import { readFile, writeFile, listDir, getWorkspace, setWorkspace } from '../api/files';
import type { FileTreeNode } from '../api/files';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OpenFile {
  /** Workspace-relative path, e.g. "src/index.ts" */
  path: string;
  content: string;
  /** Content at last save (used to detect dirty state). */
  savedContent: string;
}

export interface EditorState {
  workspacePath: string;
  fileTree: FileTreeNode[];
  treeLoading: boolean;
  treeError: string | null;
  openFiles: OpenFile[];
  activeFilePath: string | null;
}

export interface EditorActions {
  openFolder: (absPath: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  expandDir: (relPath: string) => Promise<FileTreeNode[]>;
  openFile: (relPath: string) => Promise<void>;
  closeFile: (relPath: string) => void;
  setActiveFile: (relPath: string) => void;
  updateContent: (relPath: string, content: string) => void;
  saveFile: (relPath: string) => Promise<void>;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useEditorState(): EditorState & EditorActions {
  const [workspacePath, setWorkspacePath] = useState('');
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePathState] = useState<string | null>(null);

  // Keep a ref of the latest openFiles for use inside callbacks without stale closure issues
  const openFilesRef = useRef<OpenFile[]>(openFiles);
  openFilesRef.current = openFiles;

  // ── Load initial workspace on mount (once) ──────────────────────────────────
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    getWorkspace()
      .then((r) => setWorkspacePath(r.root))
      .catch(() => undefined);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const nodes = await listDir('', 1);
      setFileTree(nodes);
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreeLoading(false);
    }
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const openFolder = useCallback(
    async (absPath: string) => {
      setTreeLoading(true);
      setTreeError(null);
      try {
        const result = await setWorkspace(absPath);
        setWorkspacePath(result.root);
        const nodes = await listDir('', 1);
        setFileTree(nodes);
        // Close all open files when switching workspace
        setOpenFiles([]);
        setActiveFilePathState(null);
      } catch (err) {
        setTreeError(err instanceof Error ? err.message : String(err));
      } finally {
        setTreeLoading(false);
      }
    },
    [],
  );

  const refreshTree = useCallback(async () => {
    await loadTree();
  }, [loadTree]);

  const expandDir = useCallback(async (relPath: string): Promise<FileTreeNode[]> => {
    const nodes = await listDir(relPath, 1);
    return nodes;
  }, []);

  const openFile = useCallback(async (relPath: string) => {
    // If already open, just activate
    const existing = openFilesRef.current.find((f) => f.path === relPath);
    if (existing) {
      setActiveFilePathState(relPath);
      return;
    }
    try {
      const result = await readFile(relPath);
      const file: OpenFile = {
        path: relPath,
        content: result.content,
        savedContent: result.content,
      };
      setOpenFiles((prev) => [...prev, file]);
      setActiveFilePathState(relPath);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, []);

  const closeFile = useCallback((relPath: string) => {
    setOpenFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === relPath);
      if (idx === -1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      // Update active file
      setActiveFilePathState((active) => {
        if (active !== relPath) return active;
        if (next.length === 0) return null;
        // Prefer the file to the left, otherwise the one to the right
        return next[Math.max(0, idx - 1)].path;
      });
      return next;
    });
  }, []);

  const setActiveFile = useCallback((relPath: string) => {
    setActiveFilePathState(relPath);
  }, []);

  const updateContent = useCallback((relPath: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === relPath ? { ...f, content } : f)),
    );
  }, []);

  const saveFile = useCallback(async (relPath: string) => {
    const file = openFilesRef.current.find((f) => f.path === relPath);
    if (!file) return;
    await writeFile(relPath, file.content);
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === relPath ? { ...f, savedContent: f.content } : f)),
    );
  }, []);

  return {
    workspacePath,
    fileTree,
    treeLoading,
    treeError,
    openFiles,
    activeFilePath,
    openFolder,
    refreshTree,
    expandDir,
    openFile,
    closeFile,
    setActiveFile,
    updateContent,
    saveFile,
  };
}
