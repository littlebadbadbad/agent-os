import { useState, useEffect } from 'react';
import { mcpToolset } from '../../agents';
import { McpManagerPanel } from './McpManagerPanel';
import { DropdownPanel } from '../DropdownPanel';
import styles from './McpButton.module.scss';

export function McpButton() {
  const [mcpServers, setMcpServers] = useState(() => mcpToolset.store.getAll());

  useEffect(
    () => mcpToolset.store.subscribe(() => setMcpServers([...mcpToolset.store.getAll()])),
    [],
  );

  async function syncMcp() {
    await mcpToolset.sync();
  }

  useEffect(() => { syncMcp(); }, []);

  const connectedMcp  = mcpServers.filter((s) => s.enabled && s.status === 'connected');
  const errorMcp      = mcpServers.filter((s) => s.enabled && s.status === 'error');
  const connectingMcp = mcpServers.filter((s) => s.enabled && s.status === 'connecting');
  const hasMcp        = mcpServers.length > 0;

  return (
    <DropdownPanel
      trigger={
        <button
          className={`${styles.mcpPill} ${
            !hasMcp
              ? styles.mcpEmpty
              : errorMcp.length > 0
              ? styles.mcpError
              : connectingMcp.length > 0
              ? styles.mcpConnecting
              : connectedMcp.length > 0
              ? styles.mcpOk
              : styles.mcpEmpty
          }`}
          title="管理 MCP 服务器"
        >
          <span className={styles.mcpDot} />
          MCP
          {connectedMcp.length > 0 && <span className={styles.mcpCount}>{connectedMcp.length}</span>}
        </button>
      }
    >
      {({ close }) => (
        <McpManagerPanel
          servers={mcpServers}
          onSync={syncMcp}
          onClose={close}
        />
      )}
    </DropdownPanel>
  );
}
