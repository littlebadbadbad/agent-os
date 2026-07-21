import React, { lazy, Suspense } from 'react';
import { useEditorState } from '../../hooks/useEditorState';
import { WorkspacePicker } from './WorkspacePicker';
import { FileTree } from './FileTree';
import { EditorTabs } from './EditorTabs';
import styles from './EditorPage.module.scss';

// Lazy-load Monaco to avoid shipping it in the main bundle
const MonacoEditor = lazy(() =>
  import('./MonacoEditor').then((m) => ({ default: m.MonacoEditor })),
);

// ── Welcome screen shown when no file is open ─────────────────────────────────

function WelcomePanel({ hasWorkspace }: { hasWorkspace: boolean }) {
  return (
    <div className={styles.welcome}>
      {hasWorkspace ? (
        <>
          <div className={styles.welcomeIcon}>📄</div>
          <p className={styles.welcomeText}>从左侧文件树选择一个文件打开</p>
        </>
      ) : (
        <>
          <div className={styles.welcomeIcon}>📁</div>
          <p className={styles.welcomeText}>在上方输入本地项目路径以打开文件夹</p>
        </>
      )}
    </div>
  );
}

// ── EditorPage ────────────────────────────────────────────────────────────────

export function EditorPage() {
  const state = useEditorState();

  const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) ?? null;

  return (
    <div className={styles.page}>
      {/* Top bar: workspace path picker */}
      <WorkspacePicker
        currentPath={state.workspacePath}
        loading={state.treeLoading}
        onOpen={state.openFolder}
      />

      {/* Main area: sidebar + editor */}
      <div className={styles.body}>
        {/* Sidebar: file tree */}
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

        {/* Editor area: tabs + editor */}
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
              <WelcomePanel hasWorkspace={state.fileTree.length > 0 || !!state.workspacePath} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
