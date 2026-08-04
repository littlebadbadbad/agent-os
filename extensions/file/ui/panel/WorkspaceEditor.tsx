/**
 * extensions/file/ui/panel/WorkspaceEditor.tsx — Single-workspace editor view
 *
 * Ported from the devops plugin's `EditorPage`, simplified: the workspace
 * root is always known up front (chosen via `WorkspaceTabBar`), so there is
 * no embedded folder picker or "no workspace" branch here — just the file
 * tree + tabs + editor for one fixed root.
 */

import { lazy, Suspense } from 'react';
import type { FileWorkspaceApi } from '../api/workspaceApi';
import { useWorkspaceEditor } from './useWorkspaceEditor';
import { FileTree } from './FileTree';
import { EditorTabs } from './EditorTabs';
import styles from './WorkspaceEditor.module.scss';

const MonacoEditor = lazy(() =>
  import('./MonacoEditor').then((m) => ({ default: m.MonacoEditor })),
);

interface Props {
  readonly api: FileWorkspaceApi;
  readonly root: string;
}

export function WorkspaceEditor({ api, root }: Props) {
  const state = useWorkspaceEditor(api, root);
  const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) ?? null;

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <FileTree
          nodes={state.fileTree}
          loading={state.treeLoading}
          error={state.treeError}
          activeFilePath={state.activeFilePath}
          onFileClick={state.openFile}
          onExpandDir={state.expandDir}
          onRefresh={state.refreshTree}
        />
      </aside>

      <div className={styles.editorArea}>
        <EditorTabs
          openFiles={state.openFiles}
          activeFilePath={state.activeFilePath}
          onActivate={state.setActiveFile}
          onClose={state.closeFile}
        />

        <div className={styles.editorPane}>
          {activeFile ? (
            <Suspense fallback={<div className={styles.loading}>加载编辑器…</div>}>
              <MonacoEditor
                key={activeFile.path}
                filePath={activeFile.path}
                content={activeFile.content}
                onChange={(val) => state.updateContent(activeFile.path, val)}
                onSave={() => state.saveFile(activeFile.path)}
              />
            </Suspense>
          ) : (
            <div className={styles.welcome}>
              <div className={styles.welcomeIcon}>📄</div>
              <p className={styles.welcomeText}>从左侧文件树选择一个文件打开</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
