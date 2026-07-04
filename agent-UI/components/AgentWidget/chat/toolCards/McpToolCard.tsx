import type { ReactElement } from 'react';
import type { ToolCallInfo } from '../../types';
import {
  CardShell, CardHeader, Chip, InfoRow, ErrorResult, PlainResult,
  argStr, resObj, resStr,
} from './shared';
import styles from '../../AgentWidget.module.scss';

const OP_META: Record<string, { icon: string; label: string }> = {
  list_mcp_servers:    { icon: '≡',  label: 'List MCP Servers' },
  add_mcp_server:      { icon: '+',  label: 'Add MCP Server' },
  remove_mcp_server:   { icon: '✕',  label: 'Remove MCP Server' },
  connect_mcp_server:  { icon: '⟳',  label: 'Connect MCP Server' },
  disable_mcp_server:  { icon: '⏸',  label: 'Disable MCP Server' },
};

function statusChip(status: string): ReactElement {
  const color =
    status === 'connected'   ? '#16a34a' :
    status === 'connecting'  ? '#d97706' :
    status === 'error'       ? '#dc2626' :
    '#6b7280';
  return <Chip label={status} color={color} />;
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function McpToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const op = OP_META[name] ?? { icon: '🔌', label: name };

  const serverName = argStr(args, 'name');
  const url        = argStr(args, 'url');
  const transport  = argStr(args, 'transport');

  const nameBadge = serverName
    ? <Chip label={serverName} color="#0d9488" mono />
    : undefined;

  // Parse result for connect/add to show new status
  const ro = resObj(result);
  const resultStatus = ro ? resStr(ro['status']) : null;

  const body = (): ReactElement | null => {
    switch (name) {
      case 'add_mcp_server':
        return (
          <>
            {url       && <InfoRow label="url"       value={<code>{url}</code>} />}
            {transport && <InfoRow label="transport" value={<Chip label={transport} />} />}
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : resultStatus ? <InfoRow label="status" value={statusChip(resultStatus)} />
                : <PlainResult result={result} />
            )}
          </>
        );

      case 'connect_mcp_server':
        return (
          <>
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : resultStatus ? <InfoRow label="status" value={statusChip(resultStatus)} />
                : <PlainResult result={result} />
            )}
          </>
        );

      default:
        if (status !== 'running') {
          return error ? <ErrorResult error={error} /> : <PlainResult result={result} />;
        }
        return null;
    }
  };

  return (
    <CardShell family="mcp">
      <CardHeader
        icon={op.icon}
        label={op.label}
        badge={nameBadge}
        status={status}
      />
      <div className={styles['tc-body']}>
        {body()}
      </div>
    </CardShell>
  );
}
