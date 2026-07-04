import type { ReactElement } from 'react';
import type { TodoItem } from '@agent-sdk';
import styles from '../AgentWidget.module.scss';

const STATUS_ICONS: Record<string, string> = {
  'not-started': '○',
  'in-progress': '◎',
  completed: '✓',
  blocked: '⊘',
};

const PRIORITY_SYMBOLS: Record<string, string> = {
  high: '↑',
  medium: '→',
  low: '↓',
};

export function TodoPanel({
  todos,
}: {
  todos: readonly TodoItem[];
}): ReactElement {

  if (todos.length === 0) {
    return (
      <div className={styles['tools-empty']}>
        No tasks yet. Give the agent a complex multi-step goal and it will plan tasks here.
      </div>
    );
  }

  const done = todos.filter((t) => t.status === 'completed').length;
  const pct = Math.round((done / todos.length) * 100);

  return (
    <div className={styles['todo-panel']}>
      <div className={styles['todo-progress-track']}>
        <div className={styles['todo-progress-bar']} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles['todo-progress-label']}>
        {done}/{todos.length} completed
      </div>
      <div className={styles['todo-list']}>
        {todos.map((item) => (
          <div
            key={item.id}
            className={`${styles['todo-item']} ${styles[`todo-item--${item.status}`]}`}
          >
            <span
              className={`${styles['todo-status-icon']} ${styles[`todo-status-icon--${item.status}`]}`}
              aria-label={item.status}
            >
              {STATUS_ICONS[item.status] ?? '○'}
            </span>
            <span className={styles['todo-title']}>{item.title}</span>
            {item.priority && (
              <span
                className={`${styles['todo-priority']} ${styles[`todo-priority--${item.priority}`]}`}
                title={`Priority: ${item.priority}`}
              >
                {PRIORITY_SYMBOLS[item.priority]}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
