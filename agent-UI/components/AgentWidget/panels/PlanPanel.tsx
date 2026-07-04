import type { ReactElement } from 'react';
import { MarkdownText } from '../chat/MarkdownText';
import styles from '../AgentWidget.module.scss';

export function PlanPanel({ plan }: { plan: string }): ReactElement {
  return (
    <div className={styles['plan-panel']}>
      <MarkdownText text={plan} />
    </div>
  );
}
