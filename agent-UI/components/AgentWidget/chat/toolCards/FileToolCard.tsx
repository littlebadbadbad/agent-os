import type { ReactElement, ReactNode } from 'react';
import type { ToolCallInfo } from '../../types';
import {
  CardShell, CardHeader, Chip, CollapsibleSection, CodeBlock,
  InfoRow, ErrorResult, PlainResult, argStr, argNum, resObj, resStr,
} from './shared';
import styles from '../../AgentWidget.module.scss';

// ── Per-operation metadata ────────────────────────────────────────────────────

const FILE_OP: Record<string, { icon: string; label: string; destructive?: boolean }> = {
  read_file:           { icon: '📄', label: 'Read File' },
  write_file:          { icon: '✎',  label: 'Write File' },
  str_replace:         { icon: '⟺', label: 'Edit File' },
  delete_file:         { icon: '🗑', label: 'Delete File', destructive: true },
  move_file:           { icon: '↷',  label: 'Move File' },
  list_dir:            { icon: '📁', label: 'List Directory' },
  search_files:        { icon: '🔍', label: 'Search Files' },
  get_workspace_root:  { icon: '🏠', label: 'Workspace Root' },
  set_workspace_root:  { icon: '📌', label: 'Set Workspace Root' },
};

// ── Path chip helper ──────────────────────────────────────────────────────────

function PathChip({ path }: { path: string }): ReactElement {
  return <Chip label={path} color="#d97706" mono />;
}

// ── Operation-specific body sections ─────────────────────────────────────────

function ReadFileBody({
  args,
  status,
  result,
}: {
  args: Record<string, unknown>;
  status: string;
  result: unknown;
}): ReactElement | null {
  const start = argNum(args, 'startLine');
  const end   = argNum(args, 'endLine');
  const range = start != null || end != null
    ? `lines ${start ?? 1}–${end ?? '…'}`
    : null;

  const ro = resObj(result);
  const content = ro ? resStr(ro['content']) : resStr(result);
  const totalLines = ro ? (typeof ro['totalLines'] === 'number' ? ro['totalLines'] : null) : null;
  const hasMore = ro ? !!ro['has_more'] : false;

  return (
    <>
      {range && <InfoRow label="range" value={<code>{range}</code>} />}
      {status !== 'running' && content != null && (
        <CollapsibleSection
          label={`content${totalLines != null ? ` (${totalLines} lines)` : ''}${hasMore ? ' — paginated' : ''}`}
          defaultOpen={!hasMore}
        >
          <CodeBlock code={content} maxLines={60} />
        </CollapsibleSection>
      )}
    </>
  );
}

function WriteFileBody({
  args,
  status,
  result,
  error,
}: {
  args: Record<string, unknown>;
  status: string;
  result: unknown;
  error?: string;
}): ReactElement | null {
  const content = argStr(args, 'content');
  const lineCount = content ? content.split('\n').length : 0;
  return (
    <>
      {content != null && (
        <InfoRow label="size" value={`${lineCount} lines, ${content.length.toLocaleString()} chars`} />
      )}
      {status !== 'running' && (
        error ? <ErrorResult error={error} /> : <PlainResult result={result} />
      )}
    </>
  );
}

function StrReplaceBody({
  args,
  status,
  result,
  error,
}: {
  args: Record<string, unknown>;
  status: string;
  result: unknown;
  error?: string;
}): ReactElement | null {
  const oldStr = argStr(args, 'oldStr');
  const newStr = argStr(args, 'newStr');
  return (
    <>
      {oldStr != null && (
        <CollapsibleSection label="replace" defaultOpen>
          <div className={styles['tc-diff-old']}>
            <span className={styles['tc-diff-label']}>−</span>
            <pre>{oldStr}</pre>
          </div>
          <div className={styles['tc-diff-new']}>
            <span className={styles['tc-diff-label']}>+</span>
            <pre>{newStr ?? ''}</pre>
          </div>
        </CollapsibleSection>
      )}
      {status !== 'running' && (
        error ? <ErrorResult error={error} /> : <PlainResult result={result} />
      )}
    </>
  );
}

function MoveFileBody({
  args,
  status,
  result,
  error,
}: {
  args: Record<string, unknown>;
  status: string;
  result: unknown;
  error?: string;
}): ReactElement | null {
  const from = argStr(args, 'from');
  const to   = argStr(args, 'to');
  return (
    <>
      {from && <InfoRow label="from" value={<code>{from}</code>} />}
      {to   && <InfoRow label="to"   value={<code>{to}</code>} />}
      {status !== 'running' && (
        error ? <ErrorResult error={error} /> : <PlainResult result={result} />
      )}
    </>
  );
}

function SearchFilesBody({
  args,
  status,
  result,
  error,
}: {
  args: Record<string, unknown>;
  status: string;
  result: unknown;
  error?: string;
}): ReactElement | null {
  const pattern = argStr(args, 'pattern');
  const content = argStr(args, 'content');

  const ro = resObj(result);
  const matches: ReactNode = (() => {
    if (ro == null) return null;
    const arr = ro['matches'];
    if (!Array.isArray(arr) || arr.length === 0) return <span style={{ opacity: 0.5 }}>no matches</span>;
    return (
      <ul className={styles['tc-item-list']}>
        {(arr as unknown[]).map((m, i) => (
          <li key={i}><code>{String(m)}</code></li>
        ))}
      </ul>
    );
  })();

  return (
    <>
      {pattern && <InfoRow label="pattern" value={<code>{pattern}</code>} />}
      {content && <InfoRow label="content" value={<code>{content}</code>} />}
      {status !== 'running' && (
        error ? <ErrorResult error={error} /> : matches ?? <PlainResult result={result} />
      )}
    </>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function FileToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const op = FILE_OP[name] ?? { icon: '📄', label: name };

  // Primary path badge — different arg key per tool
  const primaryPath =
    argStr(args, 'path') ??
    argStr(args, 'from') ??
    (name === 'get_workspace_root' ? undefined : undefined);

  // Render body based on operation
  const body = (): ReactElement | null => {
    switch (name) {
      case 'read_file':
        return <ReadFileBody args={args} status={status} result={result} />;
      case 'write_file':
        return <WriteFileBody args={args} status={status} result={result} error={error} />;
      case 'str_replace':
        return <StrReplaceBody args={args} status={status} result={result} error={error} />;
      case 'move_file':
        return <MoveFileBody args={args} status={status} result={result} error={error} />;
      case 'search_files':
        return <SearchFilesBody args={args} status={status} result={result} error={error} />;
      default:
        if (status !== 'running') {
          return error ? <ErrorResult error={error} /> : <PlainResult result={result} />;
        }
        return null;
    }
  };

  return (
    <CardShell family="file">
      <CardHeader
        icon={op.icon}
        label={op.label}
        badge={primaryPath ? <PathChip path={primaryPath} /> : undefined}
        status={status}
      />
      <div className={styles['tc-body']}>
        {body()}
      </div>
    </CardShell>
  );
}
