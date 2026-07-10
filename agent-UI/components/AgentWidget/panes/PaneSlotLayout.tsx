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

import { type ReactElement, type ReactNode, useState, useMemo } from 'react';
import type { SlotSession, SlotDisplayContext, PanelSlotDeclaration } from '@agent-type';
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

  /** The main content (chat + input). */
  readonly children: ReactNode;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Shared slot layout: headerBar → tab bar → content area.
 *
 * The tab bar shows a "Chat" tab plus one tab per visible panel slot.
 * Content area renders `children` (the chat view) or the selected
 * panel's SlotRenderer.
 */
export function PaneSlotLayout(props: PaneSlotLayoutProps): ReactElement {
  const { slotSession, headerBarSlots, panelSlots, inlinePromptSlots, slotCtx, children } = props;

  const [paneView, setPaneView] = useState<string>('chat');

  // Reset to chat when the selected panel is no longer available.
  const effectiveView = useMemo(() => {
    if (paneView === 'chat') return 'chat';
    const pluginId = paneView.slice('plugin:'.length);
    return panelSlots.some((p) => p.pluginId === pluginId) ? paneView : 'chat';
  }, [paneView, panelSlots]);

  return (
    <>
      {/* HeaderBar slots — thin full-width bars above the tab bar.
          shouldRender is checked inside SlotRenderer via slotRegistry. */}
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

      {/* Tab bar: Chat + one tab per visible panel slot. */}
      {panelSlots.length > 0 && (
        <div className={styles['tab-bar']}>
          <button
            type="button"
            className={`${styles['tab']}${effectiveView === 'chat' ? ` ${styles['tab--active']}` : ''}`}
            onClick={() => setPaneView('chat')}
          >
            Chat
          </button>
          {panelSlots.map((entry) => {
            const v = `plugin:${entry.pluginId}`;
            const badge = entry.declaration.badge?.(slotCtx) ?? null;
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
        </div>
      )}

      {/* Content area: chat view or selected panel.
          Uses CSS display:none (styles['hidden']) instead of unmounting so
          that the chat panel retains its scroll position when switching
          to a plugin tab and back. */}
      <div
        className={effectiveView === 'chat' ? styles['chat-panel'] : styles['hidden']}
      >
        {children}
      </div>
      {effectiveView !== 'chat' && slotSession && panelSlots
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

      {/* InlinePrompt slots — overlay iframes (pending-input prompts, etc.).
          shouldRender is checked inside SlotRenderer via declaration prop. */}
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
