import type { ReactElement } from 'react';
import type { ToolCallInfo } from '../../types';
import {
  CardShell, CardHeader, Chip, InfoRow, ErrorResult, argStr, argArr, resStr,
} from './shared';
import styles from '../../AgentWidget.module.scss';

type AskType = 'text' | 'confirm' | 'select';

const TYPE_ICON: Record<AskType, string> = {
  text:    '✎',
  confirm: '?',
  select:  '☰',
};

const TYPE_COLOR: Record<AskType, string> = {
  text:    '#ea580c',
  confirm: '#d97706',
  select:  '#7c3aed',
};

// ── Main card ─────────────────────────────────────────────────────────────────

export function AskUserCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { arguments: args, status, result, error } = info;

  const rawType    = argStr(args, 'type') as AskType | undefined;
  const askType    = rawType && rawType in TYPE_ICON ? rawType : 'text';
  const question   = argStr(args, 'question') ?? '';
  const placeholder = argStr(args, 'placeholder');
  const defaultVal  = argStr(args, 'default_value');
  const options     = argArr(args, 'options')?.map(String);

  const answer = resStr(result);
  const cancelled = answer === null && status === 'done';

  const typeBadge = (
    <Chip label={askType} color={TYPE_COLOR[askType]} />
  );

  return (
    <CardShell family="ask">
      <CardHeader
        icon={TYPE_ICON[askType]}
        label="Ask User"
        badge={typeBadge}
        status={status}
      />
      <div className={styles['tc-body']}>
        {/* Question */}
        <div className={styles['tc-ask-question']}>{question}</div>

        {/* Extra metadata */}
        {askType === 'text' && placeholder && (
          <InfoRow label="placeholder" value={<span style={{ opacity: 0.65 }}>{placeholder}</span>} />
        )}
        {askType === 'text' && defaultVal && (
          <InfoRow label="default" value={<code>{defaultVal}</code>} />
        )}

        {/* Select options */}
        {askType === 'select' && options && options.length > 0 && (
          <div className={styles['tc-ask-options']}>
            {options.map((opt, i) => (
              <span
                key={i}
                className={`${styles['tc-ask-option']} ${answer === opt ? styles['tc-ask-option--chosen'] : ''}`}
              >
                {opt}
              </span>
            ))}
          </div>
        )}

        {/* Result: user's answer */}
        {status !== 'running' && (
          error ? (
            <div className={`${styles['tc-ask-answer']} ${styles['tc-ask-answer--error']}`}>{error}</div>
          ) : cancelled ? (
            <div className={`${styles['tc-ask-answer']} ${styles['tc-ask-answer--cancel']}`}>cancelled</div>
          ) : answer != null ? (
            <div className={styles['tc-ask-answer']}>
              <span className={styles['tc-ask-answer-label']}>Answer</span>
              <span className={styles['tc-ask-answer-value']}>{answer}</span>
            </div>
          ) : null
        )}
      </div>
    </CardShell>
  );
}
