import { type ReactElement, useMemo, useSyncExternalStore } from 'react';
import type { SlotDisplayContext, SlotSession, PluginStateExtension } from '@agent-type';
import { ProxyButton } from '../ProxyManager/ProxyButton';
import { ProviderSelector } from '../ProviderSelector/ProviderSelector';
import { SlotRenderer } from '../../slots/SlotRenderer';
import { useSlotRegistry } from '../../plugin/PluginContext';
import { DropdownPanel } from '../DropdownPanel';
import styles from './AIControlBar.module.scss';

export interface AIControlBarProps {
  /**
   * Active session for plugin slot panels.
   * May be null — toolButton slots are session-independent and can render
   * without an active session (callbacks receive empty context and undefined state).
   */
  readonly activeSession?: SlotSession | null;
}

/**
 * Toolbar bar that sits below the sidebar header, providing quick-access
 * buttons for AI-related controls: provider/model selection, proxy,
 * and any plugin-registered toolButton slots.
 *
 * Plugin toolButton slots are discovered via
 * {@link slotRegistry} — no plugin name is hardcoded.
 *
 * When no session is active, toolButton slots still render but with empty
 * display context and undefined toolset state — they handle this gracefully
 * via the optional state parameter in their callbacks.
 */
export function AIControlBar({ activeSession }: AIControlBarProps): ReactElement {
  const { getByType } = useSlotRegistry();

  // Subscribe to session state only when a session exists.
  const sessionState = useSyncExternalStore(
    activeSession?.subscribe ?? (() => () => {}),
    () => activeSession?.getState() ?? null,
    () => activeSession?.getState() ?? null,
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

  // Derive toolset state lookup from session state.
  const toolSetState = useMemo<Record<symbol, PluginStateExtension> | null>(() => {
    if (!sessionState) return null;
    const result: Record<symbol, PluginStateExtension> = Object.create(null);
    const symbols = Object.getOwnPropertySymbols(sessionState);
    for (const sym of symbols) {
      result[sym] = sessionState[sym] as PluginStateExtension;
    }
    return result;
  }, [sessionState]);

  const toolButtonSlots = getByType('toolButton')
    .slice()
    .sort((a, b) => (a.declaration.order ?? 100) - (b.declaration.order ?? 100));

  return (
    <div className={styles['bar']}>
      <ProviderSelector />
      <ProxyButton />
      {toolButtonSlots.map((entry) => {
        const state = toolSetState?.[entry.toolSetSymbol];
        const show = entry.declaration.showBtn(slotCtx, state);
        if (!show) return null;
        const badgeText = entry.declaration.badge?.(slotCtx, state) ?? null;
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
            {() => (
              <SlotRenderer
                slotType="toolButton"
                pluginId={entry.pluginId}
                slotId={entry.slotId}
                session={activeSession}
                toolSetSymbol={entry.toolSetSymbol}
              />
            )}
          </DropdownPanel>
        );
      })}
    </div>
  );
}
