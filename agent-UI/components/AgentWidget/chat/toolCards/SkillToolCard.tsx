import type { ReactElement } from 'react';
import type { ToolCallInfo } from '../../types';
import {
  CardShell, CardHeader, Chip, CollapsibleSection, CodeBlock,
  InfoRow, ErrorResult, PlainResult, argStr,
} from './shared';
import styles from '../../AgentWidget.module.scss';

const OP_META: Record<string, { icon: string; label: string }> = {
  install_skill:   { icon: '⬇', label: 'Install Skill' },
  list_skills:     { icon: '≡', label: 'List Skills' },
  remove_skill:    { icon: '✕', label: 'Remove Skill' },
  read_skill_file: { icon: '📄', label: 'Read Skill File' },
};

// ── Main card ─────────────────────────────────────────────────────────────────

export function SkillToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const op = OP_META[name] ?? { icon: '⭐', label: name };

  const skillName = argStr(args, 'name') ?? argStr(args, 'skill');
  const url       = argStr(args, 'url');
  const skillPath = argStr(args, 'path');
  const content   = argStr(args, 'content');

  const nameBadge = skillName
    ? <Chip label={skillName} color="#16a34a" mono />
    : url
    ? <Chip label={url} color="#16a34a" mono />
    : undefined;

  const body = (): ReactElement | null => {
    switch (name) {
      case 'install_skill':
        return (
          <>
            {url     && <InfoRow label="url"     value={<code>{url}</code>} />}
            {content && (
              <CollapsibleSection label="content" defaultOpen={false}>
                <CodeBlock code={content} maxLines={30} />
              </CollapsibleSection>
            )}
            {status !== 'running' && (
              error ? <ErrorResult error={error} /> : <PlainResult result={result} />
            )}
          </>
        );

      case 'read_skill_file':
        return (
          <>
            {skillPath && <InfoRow label="path" value={<code>{skillPath}</code>} />}
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
    <CardShell family="skill">
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
