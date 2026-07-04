import type { ReactElement } from 'react';
import type { ToolCallInfo } from '../../types';
import type { TodoItem, TodoStatus } from '@agent-sdk';
import {
  CardShell, CardHeader, ErrorResult, PlainResult, argArr,
} from './shared';
import styles from '../../AgentWidget.module.scss';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_ICON: Record<TodoStatus, string> = {
  'not-started': '○',
  'in-progress': '●',
  'completed':   '✓',
  'blocked':     '✗',
};

const STATUS_MOD: Record<TodoStatus, string> = {
  'not-started': 'todo-status--pending',
  'in-progress': 'todo-status--active',
  'completed':   'todo-status--done',
  'blocked':     'todo-status--blocked',
};

const PRIORITY_MOD: Record<string, string> = {
  high:   'todo-priority--high',
  medium: 'todo-priority--medium',
  low:    'todo-priority--low',
};

function TodoRow({ item }: { item: TodoItem }): ReactElement {
  return (
    <li className={styles['tc-todo-item']}>
      <span className={`${styles['tc-todo-dot']} ${styles[STATUS_MOD[item.status]]}`}>
        {STATUS_ICON[item.status]}
      </span>
      <span className={`${styles['tc-todo-title']} ${item.status === 'completed' ? styles['tc-todo-done'] : ''}`}>
        {item.title}
      </span>
      {item.priority && (
        <span className={`${styles['tc-priority']} ${styles[PRIORITY_MOD[item.priority] ?? '']}`}>
          {item.priority}
        </span>
      )}
    </li>
  );
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
    <CardShell family="todo">
      <CardHeader
        icon="☑"
        label={isWrite ? 'Update Tasks' : 'Read Tasks'}
        badge={badge}
        status={status}
      />
      <div className={styles['tc-body']}>
        {todos.length > 0 && (
          <ul className={styles['tc-todo-list']}>
            {todos.map((t) => <TodoRow key={t.id} item={t} />)}
          </ul>
        )}
        {status !== 'running' && todos.length === 0 && (
          error ? <ErrorResult error={error} /> : <PlainResult result={result} />
        )}
      </div>
    </CardShell>
  );
}
