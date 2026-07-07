/**
 * extensions/todo/ui/TodoCompactCard.tsx — Compact tool card for todo_write/todo_read
 *
 * Renders a minimal inline chip showing the tool name and a summary badge.
 * Used in compact chat mode where space is limited.
 */

import type { ReactElement } from 'react';
import type { ToolCallInfo } from '@agent-type';
import type { TodoItem } from '../agent/types';
import styles from './styles.module.scss';

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

// ── Main compact card ─────────────────────────────────────────────────────────

export function TodoCompactCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args } = info;

  const isWrite = name === 'todo_write';
  const rawTodos = isWrite ? argArr(args, 'todos') : undefined;
  const todos = rawTodos?.filter(isTodoItem) ?? [];

  const done = todos.filter((t) => t.status === 'completed').length;
  const badge = todos.length > 0 ? `${done}/${todos.length}` : '';

  return (
    <span className={styles['tc-compact']}>
      <span className={styles['tc-compact-icon']}>☑</span>
      <span className={styles['tc-compact-label']}>
        {isWrite ? 'Tasks' : 'Read'}
      </span>
      {badge && <span className={styles['tc-compact-badge']}>{badge}</span>}
    </span>
  );
}
