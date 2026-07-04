import type { ReactElement } from 'react';
import type { ToolCallInfo } from '../../types';
import {
  CardShell, CardHeader, Chip, CollapsibleSection, CodeBlock,
  InfoRow, ErrorResult, PlainResult, argStr, argObj,
} from './shared';
import styles from '../../AgentWidget.module.scss';

const OP_META: Record<string, { icon: string; label: string }> = {
  create_tool:         { icon: '⚡', label: 'Create Tool' },
  update_tool:         { icon: '✎',  label: 'Update Tool' },
  delete_tool:         { icon: '✕',  label: 'Delete Tool' },
  list_dynamic_tools:  { icon: '≡',  label: 'List Dynamic Tools' },
};

function RuntimeChip({ runtime }: { runtime: string }): ReactElement {
  return (
    <Chip
      label={runtime}
      color={runtime === 'frontend' ? '#2563eb' : '#c2410c'}
    />
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function DynamicToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const op = OP_META[name] ?? { icon: '⚡', label: name };

  const toolName    = argStr(args, 'name');
  const description = argStr(args, 'description');
  const runtime     = argStr(args, 'runtime');
  const impl        = argStr(args, 'implementation');
  const schema      = argObj(args, 'parameters_schema');

  const nameBadge = toolName ? <Chip label={toolName} color="#4f46e5" mono /> : undefined;

  const body = (): ReactElement | null => {
    switch (name) {
      case 'create_tool':
      case 'update_tool': {
        const isUpdate = name === 'update_tool';
        return (
          <>
            {runtime && <InfoRow label="runtime" value={<RuntimeChip runtime={runtime} />} />}
            {description && (
              <div className={styles['tc-description']}>{description}</div>
            )}
            {schema && (
              <CollapsibleSection label="parameters schema" defaultOpen={false}>
                <CodeBlock code={JSON.stringify(schema, null, 2)} maxLines={20} />
              </CollapsibleSection>
            )}
            {impl && (
              <CollapsibleSection
                label={isUpdate ? 'new implementation' : 'implementation'}
                defaultOpen={!isUpdate}
              >
                <CodeBlock code={impl} maxLines={40} />
              </CollapsibleSection>
            )}
            {status !== 'running' && (
              error ? <ErrorResult error={error} /> : <PlainResult result={result} />
            )}
          </>
        );
      }

      case 'delete_tool':
        return (
          <>
            {status !== 'running' && (
              error ? <ErrorResult error={error} /> : <PlainResult result={result} />
            )}
          </>
        );

      default: // list_dynamic_tools
        if (status !== 'running') {
          return error ? <ErrorResult error={error} /> : <PlainResult result={result} />;
        }
        return null;
    }
  };

  return (
    <CardShell family="dynamic">
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
