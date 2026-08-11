/**
 * agent-UI/components/AgentWidget/panes/PaneSlotLayout.tsx
 *
 * Shared layout for rendering app slots around a chat pane.
 * Used by both `SessionContent` (main agent) and `ConversationPane`
 * (sub-agent) to render headerBar / panel-tab / inlinePrompt slots
 * with a consistent layout structure.
 *
 * This component is intentionally stateless — callers pass in all
 * data and callbacks.  It does NOT own chat input or message rendering;
 * those remain in the caller's control via the `children` prop.
 */

import { type ReactElement, type ReactNode, useState, useMemo, useCallback } from 'react';
import type { SlotSession, SlotDisplayContext, PanelSlotDeclaration, AppStateExtension } from '@agent-type';
import { SlotRenderer } from '../../../slots/SlotRenderer';
import type { SlotEntry } from '../../../slots/registry';
import styles from '../AgentWidget.module.scss';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PaneSlotLayoutProps {
  /** Slot session for headerBar / panel / inlinePrompt slot renderers. */
  readonly slotSession: SlotSession | null;

  /** Filtered headerBar slots (already filtered for visibility). */
  readonly headerBarSlots: ReadonlyArray<SlotEntry>;

  /** Filtered panel slots (already filtered for visibility). */
  readonly panelSlots: ReadonlyArray<SlotEntry<PanelSlotDeclaration>>;

  /** Filtered inlinePrompt slots (already filtered for visibility). */
  readonly inlinePromptSlots: ReadonlyArray<SlotEntry>;

  /** Slot display context for badge / visibility callbacks. */
  readonly slotCtx: SlotDisplayContext;

  /**
   * Resolve a ToolSet's symbol state for slot callbacks.
   * Returns `undefined` when no session is active or the symbol is not found.
   */
  readonly getToolSetState?: (symbol: symbol) => AppStateExtension | undefined;

  /** The main content (chat messages — no ChatInput; caller owns that). */
  readonly children: ReactNode;

  // ── Main-agent internal-apps (optional, ignored by sub-agent callers) ─

  /**
   * When set, a "Sub-Agents" tab is shown.  This content is rendered when
   * the user clicks that tab.  Only the main agent's SessionContent sets
   * this; sub-agent conversations never have sub-agents of their own.
   */
  readonly subAgentPanel?: ReactNode;

  /**
   * Extra elements appended to the right end of the tab bar, e.g. a
   * "Clear" button.  Rendered only when the chat view is active.
   */
  readonly tabBarExtra?: ReactNode;
}

// ── Component ────────────────────────────────────────────────────────────────

type View = 'chat' | 'subagents' | `app:${string}`;

/**
 * Shared slot layout: headerBar → tab bar → content area.
 *
 * Tab bar shows:
 *   Chat  [app tabs]  [Sub-Agents]  [Clear…]
 *
 * Content area renders:
 *   - `children` (chat) or the selected app panel or sub-agent panel.
 *
 * Chat messages are always mounted (CSS `display:none` when hidden) so
 * scroll position is preserved across tab switches.
 */
export function PaneSlotLayout(props: PaneSlotLayoutProps): ReactElement {
  const {
    slotSession,
    headerBarSlots,
    panelSlots,
    inlinePromptSlots,
    slotCtx,
    getToolSetState,
    children,
    subAgentPanel,
    tabBarExtra,
  } = props;

  const [paneView, setPaneView] = useState<View>('chat');

  // Clamp to a valid view when the selected panel disappears.
  const effectiveView = useMemo<View>(() => {
    if (paneView === 'chat' || paneView === 'subagents') return paneView;
    const appId = paneView.slice('app:'.length);
    if (panelSlots.some((p) => p.appId === appId)) return paneView;
    return 'chat';
  }, [paneView, panelSlots]);

  const hasAppTabs = panelSlots.length > 0;
  const hasSubAgentTab = subAgentPanel !== undefined;
  const showTabBar = hasAppTabs || hasSubAgentTab;
  const isChatActive = effectiveView === 'chat';

  return (
    <>
      {/* HeaderBar slots — thin full-width bars above the tab bar. */}
      {slotSession && headerBarSlots.map((entry) => (
        <SlotRenderer
          key={`${entry.appId}:${entry.slotId}`}
          appId={entry.appId}
          slotType="headerBar"
          slotId={entry.slotId}
          toolSetSymbol={entry.toolSetSymbol}
          session={slotSession}
        />
      ))}

      {/* Tab bar */}
      {showTabBar && (
        <div className={styles['tab-bar']}>
          <button
            type="button"
            className={`${styles['tab']}${isChatActive ? ` ${styles['tab--active']}` : ''}`}
            onClick={() => setPaneView('chat')}
          >
            Chat
          </button>

          {/* App panel tabs */}
          {hasAppTabs && panelSlots
            .slice()
            .map((entry) => {
              const v: View = `app:${entry.appId}`;
              const state = getToolSetState?.(entry.toolSetSymbol);
              const badge = entry.declaration.badge?.(slotCtx, state) ?? null;
              return (
                <button
                  key={entry.appId}
                  type="button"
                  className={`${styles['tab']}${effectiveView === v ? ` ${styles['tab--active']}` : ''}`}
                  onClick={() => setPaneView(v)}
                >
                  {entry.declaration.icon && <span className={styles['tab-icon']}>{entry.declaration.icon}</span>}
                  {entry.declaration.label}
                  {badge && <span className={styles['tab-badge']}>{badge}</span>}
                </button>
              );
            })}

          {/* Sub-Agents tab (main agent only) */}
          {hasSubAgentTab && (
            <button
              type="button"
              className={`${styles['tab']}${effectiveView === 'subagents' ? ` ${styles['tab--active']}` : ''}`}
              onClick={() => setPaneView('subagents')}
            >
              Sub-Agents
            </button>
          )}

          {/* Extra actions rendered only in chat view */}
          {isChatActive && tabBarExtra}
        </div>
      )}

      {/* Content area: chat messages — always mounted, hidden via CSS. */}
      <div className={isChatActive ? styles['chat-panel'] : styles['hidden']}>
        {children}
      </div>

      {/* App panel slot */}
      {!isChatActive && effectiveView !== 'subagents' && slotSession &&
        panelSlots
          .filter((p) => `app:${p.appId}` === effectiveView)
          .map((entry) => (
            <SlotRenderer
              key={entry.appId}
              appId={entry.appId}
              slotType="panel"
              slotId={entry.slotId}
              toolSetSymbol={entry.toolSetSymbol}
              session={slotSession}
            />
          ))}

      {/* Sub-agents panel — always mounted when present, hidden via CSS. */}
      {hasSubAgentTab && (
        <div className={effectiveView === 'subagents' ? styles['chat-panel'] : styles['hidden']}>
          {subAgentPanel}
        </div>
      )}

      {/* InlinePrompt slots — overlay iframes. */}
      {slotSession && inlinePromptSlots.map((entry) => (
        <SlotRenderer
          key={`${entry.appId}:${entry.slotId}`}
          appId={entry.appId}
          slotType="inlinePrompt"
          slotId={entry.slotId}
          toolSetSymbol={entry.toolSetSymbol}
          session={slotSession}
          declaration={entry.declaration}
        />
      ))}
    </>
  );
}
