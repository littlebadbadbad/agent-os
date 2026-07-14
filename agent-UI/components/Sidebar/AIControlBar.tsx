import { type ReactElement, useMemo, useSyncExternalStore } from 'react';
import type { SlotDisplayContext, SlotSession } from '@agent-type';
import { ProxyButton } from '../ProxyManager/ProxyButton';
import { ProviderSelector } from '../ProviderSelector/ProviderSelector';
import { slotRegistry } from '../../slots/registry';
import { SlotRenderer } from '../../slots/SlotRenderer';
import { DropdownPanel } from '../DropdownPanel';
import styles from './AIControlBar.module.scss';

export interface AIControlBarProps {
  /** Active session for plugin slot panels, or undefined when no session exists. */
  readonly activeSession: SlotSession;
}

/**
 * Toolbar bar that sits below the sidebar header, providing quick-access
 * buttons for AI-related controls: provider/model selection, proxy,
 * and any plugin-registered toolButton slots.
 *
 * Plugin toolButton slots are discovered via
 * {@link slotRegistry} — no plugin name is hardcoded.
 */
export function AIControlBar({ activeSession }: AIControlBarProps): ReactElement {
  // Derive slot display context from the active session reactively.
  const sessionState = useSyncExternalStore(
    activeSession.subscribe,
    activeSession.getState,
  );
  const slotCtx: SlotDisplayContext = useMemo(
    () => sessionState
      ? {
        sessionId: sessionState.id,
        agentName: sessionState.agentName,
        conversationId: sessionState.conversationId,
      }
      : { sessionId: '', agentName: '', conversationId: '' },
    [sessionState],
  );

  const toolButtonSlots = slotRegistry.getByType('toolButton')
    .slice()
    .sort((a, b) => (a.declaration.order ?? 100) - (b.declaration.order ?? 100));

  return (
    <div className={styles['bar']}>
      <ProviderSelector />
      <ProxyButton />
      {toolButtonSlots.map((entry) => {
        const show = entry.declaration.showBtn(slotCtx);
        if (!show) return null;
        const badgeText = entry.declaration.badge?.(slotCtx) ?? null;
        return (
          <DropdownPanel
            key={entry.slotId}
            trigger={
              <button
                className={styles['pill']}
                title={entry.declaration.label}
              >
                {entry.declaration.icon && <span>{entry.declaration.icon}</span>}
                <span>{entry.declaration.label}</span>
                {badgeText !== null && (
                  <span className={styles['badge']}>{badgeText}</span>
                )}
              </button>
            }
          >
            {activeSession
              ? () => (
                <SlotRenderer
                  slotType="toolButton"
                  pluginId={entry.pluginId}
                  slotId={entry.slotId}
                  session={activeSession}
                  toolSetSymbol={entry.toolSetSymbol}
                />
              )
              : undefined}
          </DropdownPanel>
        );
      })}
    </div>
  );
}
