/**
 * internal-apps/user-input/ui/AskUserCard.tsx — Ask User tool card (iframe-rendered)
 */

import type { ReactElement } from 'react';
import type { ToolCallInfo } from '@agent-type';
import {
  CardShell, CardHeader, Chip, InfoRow, ErrorResult, argStr, argArr, resStr, buildDevCopyData,
} from './shared';
import cardStyles from './styles.module.scss';

type AskType = 'text' | 'confirm' | 'select';

const TYPE_ICON: Record<AskType, string> = {
  text:    '\u270E',
  confirm: '?',
  select:  '\u2630',
};

const TYPE_COLOR: Record<AskType, string> = {
  text:    '#ea580c',
  confirm: '#d97706',
  select:  '#7c3aed',
};

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

  const typeBadge = <Chip label={askType} color={TYPE_COLOR[askType]} />;
  const devData = buildDevCopyData('ask_user', args, result, error);

  return (
    <CardShell family="ask" devCopyData={devData}>
      <CardHeader
        icon={TYPE_ICON[askType]}
        label="Ask User"
        badge={typeBadge}
        status={status}
      />
      <div className={cardStyles['tc-body']}>
        <div className={cardStyles['tc-ask-question']}>{question}</div>

        {askType === 'text' && placeholder && (
          <InfoRow label="placeholder" value={<span className={cardStyles['muted']}>{placeholder}</span>} />
        )}
        {askType === 'text' && defaultVal && (
          <InfoRow label="default" value={<code>{defaultVal}</code>} />
        )}

        {askType === 'select' && options && options.length > 0 && (
          <div className={cardStyles['tc-ask-options']}>
            {options.map((opt, i) => (
              <span
                key={i}
                className={`${cardStyles['tc-ask-option']} ${answer === opt ? cardStyles['tc-ask-option--chosen'] : ''}`}
              >
                {opt}
              </span>
            ))}
          </div>
        )}

        {status !== 'running' && (
          error ? (
            <div className={`${cardStyles['tc-ask-answer']} ${cardStyles['tc-ask-answer--error']}`}>{error}</div>
          ) : cancelled ? (
            <div className={`${cardStyles['tc-ask-answer']} ${cardStyles['tc-ask-answer--cancel']}`}>cancelled</div>
          ) : answer != null ? (
            <div className={cardStyles['tc-ask-answer']}>
              <span className={cardStyles['tc-ask-answer-label']}>Answer</span>
              <span className={cardStyles['tc-ask-answer-value']}>{answer}</span>
            </div>
          ) : null
        )}
      </div>
    </CardShell>
  );
}
