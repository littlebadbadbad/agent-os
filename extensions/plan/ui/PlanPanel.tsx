import type { ReactElement } from 'react';
import { MarkdownText } from './MarkdownText';
import styles from './styles.module.scss';

/**
 * PlanPanel — renders the current plan as markdown.
 */
export function PlanPanel({ plan }: { plan: string }): ReactElement {
  return (
    <div className={styles['plan-panel']}>
      <MarkdownText text={plan} />
    </div>
  );
}
