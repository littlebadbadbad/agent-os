/**
 * extensions/token-budget/ui/TokenProgressBar.tsx — Token usage progress bar
 *
 * Moved from agent-UI/components/AgentWidget/panels/TokenProgress.tsx.
 *
 * Displays a thin progress bar showing context-window usage.
 * Colour tiers: normal → warning → critical.
 */

import type { ReactElement } from 'react';
import type { TokenBudgetState } from '../agent/types';
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
