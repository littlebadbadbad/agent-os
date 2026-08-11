/**
 * internal-apps/file/ui/panel/WorkspaceTabBar.tsx — Multi-workspace tab strip
 *
 * Shows every workspace folder currently open in the panel as a tab, lets
 * the user add/close/switch between them, and surfaces the workspace root
 * the agent's `set_workspace_root` tool currently targets with a one-click
 * "jump to it" action.
 */

import { useState } from 'react';
import type { WorkspaceTab } from './useFileWorkspaces';
import type { BrowseDirResult } from '../api/workspaceApi';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import styles from './WorkspaceTabBar.module.scss';

interface Props {
  readonly workspaces: readonly WorkspaceTab[];
  readonly activeRoot: string | null;
  readonly agentRoot: string | null;
  readonly opening: boolean;
  readonly onSelect: (root: string) => void;
  readonly onClose: (root: string) => void;
  readonly onAdd: (absPath: string) => void;
  readonly onJumpToAgent: () => void;
  readonly onRefreshAgent: () => void;
  readonly onBrowse: (path: string) => Promise<BrowseDirResult>;
}

export function WorkspaceTabBar({
  workspaces, activeRoot, agentRoot, opening,
  onSelect, onClose, onAdd, onJumpToAgent, onRefreshAgent, onBrowse,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const agentRootIsOpen = agentRoot != null && workspaces.some((w) => w.root === agentRoot);

  function handleConfirm(path: string) {
    setPickerOpen(false);
    onAdd(path);
  }

  return (
    <div className={styles.bar}>
      <div className={styles.tabs} role="tablist">
        {workspaces.map((ws) => {
          const isActive = ws.root === activeRoot;
          const isAgentRoot = ws.root === agentRoot;
          return (
            <div
              key={ws.root}
              role="tab"
              aria-selected={isActive}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
              title={ws.root}
              onClick={() => onSelect(ws.root)}
            >
              <span className={styles.tabIcon}>📁</span>
              <span className={styles.tabLabel}>{ws.label}</span>
              {isAgentRoot && (
                <span className={styles.agentBadge} title="Agent 当前工作区">🤖</span>
              )}
              <button
                className={styles.closeBtn}
                onClick={(e) => { e.stopPropagation(); onClose(ws.root); }}
                title="关闭工作区"
              >
                ×
              </button>
            </div>
          );
        })}

        <button
          className={styles.addBtn}
          onClick={() => setPickerOpen(true)}
          disabled={opening}
          title="打开文件夹…"
        >
          {opening ? '打开中…' : '+ 打开文件夹'}
        </button>
      </div>

      <div className={styles.agentBar}>
        <span className={styles.agentLabel}>Agent 工作区</span>
        <button
          className={`${styles.agentPath} ${agentRootIsOpen ? styles.agentPathLinked : ''}`}
          title={agentRoot ?? '尚未设置'}
          onClick={onJumpToAgent}
          disabled={!agentRoot}
        >
          {agentRoot ?? '未设置'}
        </button>
        <button className={styles.refreshBtn} onClick={onRefreshAgent} title="刷新">↻</button>
      </div>

      {pickerOpen && (
        <FolderBrowserDialog
          initialPath={activeRoot ?? ''}
          onBrowse={onBrowse}
          onConfirm={handleConfirm}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
