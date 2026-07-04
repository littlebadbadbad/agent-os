import type { ReactElement } from 'react';
import type { TokenBudgetState } from '@agent-sdk';
import styles from './TokenProgress.module.scss';

export function TokenProgressBar({ state }: { state: TokenBudgetState }): ReactElement {
  const pct = Math.round(state.usageRatio * 100);
  const tier = state.shouldSummarize ? 'critical' : state.warning ? 'warning' : 'normal';

  return (
    <div className={styles['token-progress']} title={`last prompt: ${state.lastPromptTokens.toLocaleString()} / ${state.maxTokens.toLocaleString()} (${pct}%)`}>
      <div className={styles['token-bar']}>
        <div
          className={`${styles['token-fill']} ${styles[`token-fill--${tier}`]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`${styles['token-label']} ${styles[`token-label--${tier}`]}`}>
        {pct}%
      </span>
    </div>
  );
}
