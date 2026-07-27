/**
 * components/Sidebar/nativePills.tsx — Native (built-in) pill registry for AIControlBar
 *
 * SINGLE SOURCE OF TRUTH for all non-slot pills in the AI control bar.
 * Each entry provides either:
 *   - `component`: a self-contained black-box with its own DropdownPanel (e.g. ProviderSelector)
 *   - `popover`: a trigger button + panel content pair (e.g. ProxyButton)
 *
 * Adding a new native pill: just push another entry to NATIVE_PILLS.
 * AIControlBar iterates NATIVE_PILLS + toolButton slots and renders them uniformly.
 *
 * Pattern parallels nativeApps.tsx for desktop app slots.
 */

import type { ReactElement, ReactNode } from 'react';
import { ProxyManagerPanel } from '../ProxyManager/ProxyManagerPanel';
import { ProxyButtonTrigger } from '../ProxyManager/ProxyButton';
import { ProviderSelector } from '../ProviderSelector/ProviderSelector';

// ── Native pill entry types ──────────────────────────────────────────────────

/**
 * A self-contained pill that manages its own DropdownPanel internally.
 * Rendered as-is in the AIControlBar flex row.
 */
export interface NativeComponentPill {
  readonly kind: 'component';
  readonly slotId: string;
  readonly order: number;
  render(): ReactElement;
}

/**
 * A pill whose trigger button and dropdown panel are separate.
 * AIControlBar wraps them in a shared DropdownPanel.
 */
export interface NativePopoverPill {
  readonly kind: 'popover';
  readonly slotId: string;
  readonly order: number;
  renderTrigger(helpers: { toggle: () => void }): ReactElement;
  renderPanel(helpers: { close: () => void }): ReactNode;
  /** Optional panel width in px. */
  readonly panelWidth?: number;
  /** Optional panel height in px. */
  readonly panelHeight?: number;
}

export type NativePillEntry = NativeComponentPill | NativePopoverPill;

// ── Registry ─────────────────────────────────────────────────────────────────

/**
 * All native (built-in) pills in the AI control bar.
 * Push a new entry here to add a native pill.
 * AIControlBar, providers, and styles handle it automatically.
 */
export const NATIVE_PILLS: readonly NativePillEntry[] = [
  {
    kind: 'component',
    slotId: 'native:provider-selector',
    order: 0,
    render() {
      return <ProviderSelector />;
    },
  },
  {
    kind: 'popover',
    slotId: 'native:proxy',
    order: 1,
    panelWidth: 320,
    renderTrigger({ toggle }) {
      return <ProxyButtonTrigger onClick={toggle} />;
    },
    renderPanel({ close }) {
      return <ProxyManagerPanel onClose={close} />;
    },
  },
];
