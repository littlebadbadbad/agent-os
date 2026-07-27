import { type ReactElement, useMemo, useSyncExternalStore } from 'react';
import type { SlotDisplayContext, SlotSession, PluginStateExtension } from '@agent-type';
import { SlotRenderer } from '../../slots/SlotRenderer';
import { useSlotRegistry } from '../../plugin/PluginContext';
import { DropdownPanel } from '../DropdownPanel';
import { NATIVE_PILLS, type NativePopoverPill, type NativeComponentPill } from './nativePills';
import styles from './AIControlBar.module.scss';

// ── Slot-based bar entry (plugin-provided toolButton) ────────────────────────

interface SlotBarEntry {
  readonly kind: 'slot';
  readonly slotId: string;
  readonly order: number;
  readonly icon: string | undefined;
  readonly label: string;
  readonly badge: string | null;
  readonly pluginId: string;
  readonly toolSetSymbol: symbol;
}

/** Discriminated union of everything rendered in the bar. */
type BarEntry = NativePopoverPill | SlotBarEntry;

// ── Props ────────────────────────────────────────────────────────────────────

export interface AIControlBarProps {
  /**
   * Active session for plugin slot panels.
   * May be null — toolButton slots are session-independent and can render
   * without an active session (callbacks receive empty context and undefined state).
   */
  readonly activeSession?: SlotSession | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Render a BarEntry whose kind requires a DropdownPanel wrapper.
 */
function renderPopoverEntry(
  entry: BarEntry,
  activeSession: SlotSession | null | undefined,
): ReactElement {
  if (entry.kind === 'popover') {
    return (
      <DropdownPanel
        key={entry.slotId}
        trigger={({ toggle }) => entry.renderTrigger({ toggle })}
        panelWidth={entry.panelWidth}
        panelHeight={entry.panelHeight}
      >
        {({ close }) => entry.renderPanel({ close })}
      </DropdownPanel>
    );
  }

  // entry.kind === 'slot'
  return (
    <DropdownPanel
      key={entry.slotId}
      trigger={
        <button className={styles['pill']} title={entry.label}>
          {entry.icon && <span>{entry.icon}</span>}
          <span>{entry.label}</span>
          {entry.badge !== null && (
            <span className={styles['badge']}>{entry.badge}</span>
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
}

/**
 * Render a component-style native pill (self-contained with own DropdownPanel).
 */
function renderComponentEntry(entry: NativeComponentPill): ReactElement {
  return <entry.render key={entry.slotId} />;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Toolbar bar that sits below the sidebar header, providing quick-access
 * buttons for AI-related controls: provider/model selection, proxy,
 * and any plugin-registered toolButton slots.
 *
 * Plugin toolButton slots are discovered via
 * {@link slotRegistry} — no plugin name is hardcoded.
 *
 * Native pills (provider selector, proxy) are registered in
 * {@link NATIVE_PILLS} — add a new entry there to extend the bar.
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
  // AgentSessionState has [key: symbol]: PluginStateExtension via AgentSessionExtension.
  const toolSetState = useMemo<Record<symbol, PluginStateExtension> | null>(() => {
    if (!sessionState) return null;
    const result: Record<symbol, PluginStateExtension> = Object.create(null);
    const symbols = Object.getOwnPropertySymbols(sessionState);
    for (const sym of symbols) {
      result[sym] = sessionState[sym];
    }
    return result;
  }, [sessionState]);

  // ── Build unified entry list ─────────────────────────────────────────────

  const [componentPills, popoverPills] = useMemo(() => {
    const component: NativeComponentPill[] = [];
    const popover: NativePopoverPill[] = [];
    for (const pill of NATIVE_PILLS) {
      if (pill.kind === 'component') component.push(pill);
      else popover.push(pill);
    }
    return [component, popover];
  }, []);

  const slotEntries: SlotBarEntry[] = useMemo(() => {
    const slots = getByType('toolButton');
    const result: SlotBarEntry[] = [];
    for (let i = 0; i < slots.length; i++) {
      const entry = slots[i];
      const state = toolSetState?.[entry.toolSetSymbol];
      const show = entry.declaration.showBtn(slotCtx, state);
      if (!show) continue;
      const badgeText = entry.declaration.badge?.(slotCtx, state) ?? null;
      result.push({
        kind: 'slot',
        slotId: entry.slotId,
        order: entry.declaration.order ?? 100,
        icon: entry.declaration.icon,
        label: entry.declaration.label,
        badge: badgeText,
        pluginId: entry.pluginId,
        toolSetSymbol: entry.toolSetSymbol,
      });
    }
    result.sort((a, b) => a.order - b.order);
    return result;
  }, [getByType, slotCtx, toolSetState]);

  // Merge popover pills + slot entries, sorted by order.
  const mergedPopoverEntries: BarEntry[] = useMemo(() => {
    const all: BarEntry[] = [...popoverPills, ...slotEntries];
    all.sort((a, b) => a.order - b.order);
    return all;
  }, [popoverPills, slotEntries]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles['bar']}>
      {/* Component-style native pills render first (ProviderSelector) */}
      {componentPills.map(renderComponentEntry)}

      {/* Popover pills + slot pills interleaved by order */}
      {mergedPopoverEntries.map((entry) => renderPopoverEntry(entry, activeSession))}
    </div>
  );
}
