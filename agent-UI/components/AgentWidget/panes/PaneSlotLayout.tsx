/**
 * agent-UI/components/AgentWidget/panes/PaneSlotLayout.tsx
 *
 * Shared layout for rendering plugin slots around a chat pane.
 * Used by both `SessionContent` (main agent) and `ConversationPane`
 * (sub-agent) to render headerBar / panel-tab / inlinePrompt slots
 * with a consistent layout structure.
 *
 * This component is intentionally stateless — callers pass in all
 * data and callbacks.  It does NOT own chat input or message rendering;
 * those remain in the caller's control via the `children` prop.
 */

import { type ReactElement, type ReactNode, useState, useMemo, useCallback } from 'react';
import type { SlotSession, SlotDisplayContext, PanelSlotDeclaration, PluginStateExtension } from '@agent-type';
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
  readonly getToolSetState?: (symbol: symbol) => PluginStateExtension | undefined;

  /** The main content (chat messages — no ChatInput; caller owns that). */
  readonly children: ReactNode;

  // ── Main-agent extensions (optional, ignored by sub-agent callers) ─

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

type View = 'chat' | 'subagents' | `plugin:${string}`;

/**
 * Shared slot layout: headerBar → tab bar → content area.
 *
 * Tab bar shows:
 *   Chat  [plugin tabs]  [Sub-Agents]  [Clear…]
 *
 * Content area renders:
 *   - `children` (chat) or the selected plugin panel or sub-agent panel.
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
    const pluginId = paneView.slice('plugin:'.length);
    if (panelSlots.some((p) => p.pluginId === pluginId)) return paneView;
    return 'chat';
  }, [paneView, panelSlots]);

  const hasPluginTabs = panelSlots.length > 0;
  const hasSubAgentTab = subAgentPanel !== undefined;
  const showTabBar = hasPluginTabs || hasSubAgentTab;
  const isChatActive = effectiveView === 'chat';

  return (
    <>
      {/* HeaderBar slots — thin full-width bars above the tab bar. */}
      {slotSession && headerBarSlots.map((entry) => (
        <SlotRenderer
          key={`${entry.pluginId}:${entry.slotId}`}
          pluginId={entry.pluginId}
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

          {/* Plugin panel tabs */}
          {hasPluginTabs && panelSlots
            .slice()
            .map((entry) => {
              const v: View = `plugin:${entry.pluginId}`;
              const state = getToolSetState?.(entry.toolSetSymbol);
              const badge = entry.declaration.badge?.(slotCtx, state) ?? null;
              return (
                <button
                  key={entry.pluginId}
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

      {/* Plugin panel slot */}
      {!isChatActive && effectiveView !== 'subagents' && slotSession &&
        panelSlots
          .filter((p) => `plugin:${p.pluginId}` === effectiveView)
          .map((entry) => (
            <SlotRenderer
              key={entry.pluginId}
              pluginId={entry.pluginId}
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
          key={`${entry.pluginId}:${entry.slotId}`}
          pluginId={entry.pluginId}
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
