/**
 * internal-apps/file/ui/panel/FilePanelApp.tsx — File app app-slot root
 *
 * Renders every open workspace's `WorkspaceEditor` at once (toggling
 * visibility instead of unmounting) so switching tabs never loses tree
 * state, scroll position, or unsaved edits — plus the `WorkspaceTabBar`
 * for managing which workspaces are open and jumping to the agent's
 * current workspace root.
 */

import type { FileWorkspaceApi } from '../api/workspaceApi';
import { useFileWorkspaces } from './useFileWorkspaces';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { WorkspaceEditor } from './WorkspaceEditor';
import styles from './FilePanelApp.module.scss';

interface Props {
  readonly api: FileWorkspaceApi;
}

export function FilePanelApp({ api }: Props) {
  const wm = useFileWorkspaces(api);

  return (
    <div className={styles.app}>
      <WorkspaceTabBar
        workspaces={wm.workspaces}
        activeRoot={wm.activeRoot}
        agentRoot={wm.agentRoot}
        opening={wm.opening}
        onSelect={wm.setActive}
        onClose={wm.closeWorkspace}
        onAdd={wm.addWorkspace}
        onJumpToAgent={wm.jumpToAgentWorkspace}
        onRefreshAgent={wm.refreshAgentWorkspace}
        onBrowse={api.browseDir}
      />

      {wm.error && (
        <div className={styles.errorBar}>
          <span>{wm.error}</span>
          <button onClick={wm.dismissError}>×</button>
        </div>
      )}

      <div className={styles.body}>
        {wm.workspaces.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>📁</div>
            <p className={styles.emptyText}>点击上方“+ 打开文件夹”开始浏览一个工作区</p>
          </div>
        ) : (
          wm.workspaces.map((ws) => (
            <div
              key={ws.root}
              className={styles.workspaceSlot}
              style={{ display: ws.root === wm.activeRoot ? 'flex' : 'none' }}
            >
              <WorkspaceEditor api={api} root={ws.root} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
