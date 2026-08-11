/**
 * internal-apps/todo/ui/TodoToolCard.tsx — Full tool card for todo_write/todo_read
 *
 * Moved from agent-UI/components/AgentWidget/chat/toolCards/TodoToolCard.tsx.
 * Self-contained — includes its own CardShell/CardHeader/ErrorResult/PlainResult
 * instead of importing from shared.tsx.
 */

import type { ReactElement } from 'react';
import type { ToolCallInfo, ToolCallStatus } from '@agent-type';
import type { TodoItem, TodoStatus } from '../agent/types';
import styles from './styles.module.scss';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_ICON: Record<TodoStatus, string> = {
  'not-started': '○',
  'in-progress': '●',
  completed:   '✓',
  blocked:     '✗',
};

const STATUS_MOD: Record<TodoStatus, string> = {
  'not-started': 'todo-status--pending',
  'in-progress': 'todo-status--active',
  completed:   'todo-status--done',
  blocked:     'todo-status--blocked',
};

const PRIORITY_MOD: Record<string, string> = {
  high:   'todo-priority--high',
  medium: 'todo-priority--medium',
  low:    'todo-priority--low',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function argArr(args: Record<string, unknown>, key: string): unknown[] {
  const v = args[key];
  return Array.isArray(v) ? v : [];
}

function isTodoItem(v: unknown): v is TodoItem {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)['id'] === 'number' &&
    typeof (v as Record<string, unknown>)['title'] === 'string' &&
    typeof (v as Record<string, unknown>)['status'] === 'string'
  );
}

function formatResult(result: unknown): string {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TodoRow({ item }: { item: TodoItem }): ReactElement {
  return (
    <li className={styles['tc-todo-item']}>
      <span className={`${styles['tc-todo-dot']} ${styles[STATUS_MOD[item.status]] ?? ''}`}>
        {STATUS_ICON[item.status]}
      </span>
      <span className={`${styles['tc-todo-title']} ${item.status === 'completed' ? styles['tc-todo-done'] : ''}`}>
        {item.title}
      </span>
      {item.priority && (
        <span className={`${styles['tc-priority']} ${styles[PRIORITY_MOD[item.priority] ?? ''] ?? ''}`}>
          {item.priority}
        </span>
      )}
    </li>
  );
}

function StatusDot({ status }: { status: ToolCallStatus }): ReactElement {
  const mod = status === 'running' ? 'tc-status-dot--running'
    : status === 'done' ? 'tc-status-dot--done'
    : 'tc-status-dot--error';
  return <span className={`${styles['tc-status-dot']} ${styles[mod]}`} />;
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function TodoToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;

  const isWrite = name === 'todo_write';
  const rawTodos = isWrite ? argArr(args, 'todos') : undefined;
  const todos = rawTodos?.filter(isTodoItem) ?? [];

  // Summary counts
  const done    = todos.filter((t) => t.status === 'completed').length;
  const active  = todos.filter((t) => t.status === 'in-progress').length;
  const blocked = todos.filter((t) => t.status === 'blocked').length;
  const pending = todos.filter((t) => t.status === 'not-started').length;

  const badge = todos.length > 0 ? (
    <span className={styles['tc-todo-summary']}>
      {done}/{todos.length} done
      {active  > 0 && <span className={styles['tc-todo-summary-active']}> · {active} active</span>}
      {blocked > 0 && <span className={styles['tc-todo-summary-blocked']}> · {blocked} blocked</span>}
      {pending > 0 && <span className={styles['tc-todo-summary-pending']}> · {pending} pending</span>}
    </span>
  ) : undefined;

  return (
    <div className={styles['tc-shell']}>
      <div className={styles['tc-header']}>
        <span className={styles['tc-header-icon']}>☑</span>
        <span className={styles['tc-header-label']}>
          {isWrite ? 'Update Tasks' : 'Read Tasks'}
        </span>
        {badge && <span className={styles['tc-header-badge']}>{badge}</span>}
        <StatusDot status={status} />
      </div>
      <div className={styles['tc-body']}>
        {todos.length > 0 && (
          <ul className={styles['tc-todo-list']}>
            {todos.map((t) => <TodoRow key={t.id} item={t} />)}
          </ul>
        )}
        {status !== 'running' && todos.length === 0 && (
          error
            ? <div className={styles['tc-error']}>{error}</div>
            : <div className={styles['tc-plain']}>{formatResult(result)}</div>
        )}
      </div>
    </div>
  );
}
