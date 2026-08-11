/**
 * internal-apps/dynamic-tool/ui/toolCard.tsx — Dynamic tool card (iframe-rendered)
 */

import type { ReactElement } from 'react';
import type { ToolCallInfo } from '@agent-type';
import {
  CardShell, CardHeader, Chip, CollapsibleSection, CodeBlock,
  InfoRow, ErrorResult, PlainResult, argStr, argObj,
  buildDevCopyData,
} from './shared';
import cardStyles from './styles.module.scss';

const OP_META: Record<string, { icon: string; label: string }> = {
  create_tool:         { icon: '\u26A1', label: 'Create Tool' },
  update_tool:         { icon: '\u270E',  label: 'Update Tool' },
  delete_tool:         { icon: '\u2715',  label: 'Delete Tool' },
  list_dynamic_tools:  { icon: '\u2261',  label: 'List Dynamic Tools' },
};

function RuntimeChip({ runtime }: { runtime: string }): ReactElement {
  return (
    <Chip
      label={runtime}
      color={runtime === 'frontend' ? '#2563eb' : '#c2410c'}
    />
  );
}

export function DynamicToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const op = OP_META[name] ?? { icon: '\u26A1', label: name };

  const toolName    = argStr(args, 'name');
  const description = argStr(args, 'description');
  const runtime     = argStr(args, 'runtime');
  const impl        = argStr(args, 'implementation');
  const schema      = argObj(args, 'parameters_schema');

  const nameBadge = toolName ? <Chip label={toolName} color="#4f46e5" mono /> : undefined;
  const devData = buildDevCopyData(name, args, result, error);

  const body = (): ReactElement | null => {
    switch (name) {
      case 'create_tool':
      case 'update_tool': {
        const isUpdate = name === 'update_tool';
        return (
          <>
            {runtime && <InfoRow label="runtime" value={<RuntimeChip runtime={runtime} />} />}
            {description && (
              <div className={cardStyles['tc-description']}>{description}</div>
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

      default:
        if (status !== 'running') {
          return error ? <ErrorResult error={error} /> : <PlainResult result={result} />;
        }
        return null;
    }
  };

  return (
    <CardShell family="dynamic" devCopyData={devData}>
      <CardHeader
        icon={op.icon}
        label={op.label}
        badge={nameBadge}
        status={status}
      />
      <div className={cardStyles['tc-body']}>
        {body()}
      </div>
    </CardShell>
  );
}
