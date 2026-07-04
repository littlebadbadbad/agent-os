import type { ReactElement } from 'react';
import type { ToolCallInfo } from '../../types';
import {
  CardShell, CardHeader, Chip, InfoRow, ErrorResult, PlainResult,
  argStr, argArr,
} from './shared';
import styles from '../../AgentWidget.module.scss';

// Sub-agent meta tool names follow one of these patterns:
//   create_<suffix>_subagent
//   update_<suffix>_subagent
//   list_<suffix>_subagents
//   delete_<suffix>_subagent

function parseMetaOp(name: string): { action: string; icon: string } {
  if (name.startsWith('create_'))  return { action: 'Create Sub-agent', icon: '✎' };
  if (name.startsWith('update_'))  return { action: 'Update Sub-agent', icon: '✎' };
  if (name.startsWith('list_'))    return { action: 'List Sub-agents',  icon: '≡' };
  if (name.startsWith('delete_'))  return { action: 'Delete Sub-agent', icon: '✕' };
  return { action: name, icon: '🤖' };
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function SubAgentMetaCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const { action, icon } = parseMetaOp(name);

  const agentName   = argStr(args, 'name');
  const description = argStr(args, 'description');
  const tools       = argArr(args, 'tools')?.map(String);
  const maxTurns    = argStr(args, 'maxTurns') ?? (typeof args['maxTurns'] === 'number' ? String(args['maxTurns']) : undefined);

  const nameBadge = agentName
    ? <Chip label={agentName} color="#6d28d9" mono />
    : undefined;

  const body = (): ReactElement | null => {
    const isCreate = name.startsWith('create_');
    const isUpdate = name.startsWith('update_');

    if (isCreate || isUpdate) {
      return (
        <>
          {description && (
            <div className={styles['tc-description']}>{description}</div>
          )}
          {tools && tools.length > 0 && (
            <InfoRow
              label="tools"
              value={
                <span className={styles['tc-chip-row']}>
                  {tools.map((t) => <Chip key={t} label={t} mono />)}
                </span>
              }
            />
          )}
          {maxTurns && (
            <InfoRow label="maxTurns" value={<Chip label={`${maxTurns} turns`} />} />
          )}
          {status !== 'running' && (
            error ? <ErrorResult error={error} /> : <PlainResult result={result} />
          )}
        </>
      );
    }

    if (status !== 'running') {
      return error ? <ErrorResult error={error} /> : <PlainResult result={result} />;
    }
    return null;
  };

  return (
    <CardShell family="meta-agent">
      <CardHeader
        icon={icon}
        label={action}
        badge={nameBadge}
        status={status}
      />
      <div className={styles['tc-body']}>
        {body()}
      </div>
    </CardShell>
  );
}
