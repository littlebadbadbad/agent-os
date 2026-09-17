/**
 * GlobalToolsPanel — the toolButton dropdown.
 *
 * Session-independent: reads the full tool pool through the bridge and
 * toggles the GLOBAL disabled set, which force-disables tools in every
 * session. Rendered as a plain ToolsPanel — rows here are never `locked`
 * because this is exactly the place where global locks are managed.
 */

import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { ToolStateBridge } from '../agent/bridge';
import { ToolsPanel } from './ToolsPanel';

export function GlobalToolsPanel({
  bridge,
  version,
}: {
  bridge: ToolStateBridge;
  /** Bumped by the host wiring whenever the store or tool pool changes. */
  version: number;
}): ReactElement {
  // `version` is the external-store snapshot — re-derive the list on change.
  const toolStates = useMemo(() => [...bridge.getGlobalToolStates()], [bridge, version]);
  return <ToolsPanel toolStates={toolStates} onToggle={(name) => bridge.toggleGlobal(name)} />;
}
