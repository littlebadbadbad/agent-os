import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { ToolCallInfo, CompactToolCardSlotDeclaration } from '@agent-type';
import type { SlotEntry } from '../../../slots/registry';
import { ToolCallInlineCard } from './ToolCallInlineCard';

interface SlotToolCardProps {
  /** The app slot that claims this tool call. */
  readonly slot: SlotEntry<CompactToolCardSlotDeclaration>;
  readonly info: ToolCallInfo;
  readonly onOpen: () => void;
}

/**
 * Renders a tool call claimed by a app's `compactToolCard` slot.
 *
 * - Imperative `render` mode: the app draws its own DOM (embedded mode).
 * - Descriptor mode: the app's icon/label/summary/status are rendered with
 *   the same inline execution-note styling as the default ToolCallInlineCard.
 */
export function SlotToolCard({ slot, info, onOpen }: SlotToolCardProps): ReactElement {
  const renderRef = useRef<HTMLDivElement>(null);

  // Imperative render (embedded same-process mode).
  useEffect(() => {
    if (!slot.declaration.render) return;
    const el = renderRef.current;
    if (!el) return;
    slot.declaration.render(el, info);
  }, [slot, info]);

  if (slot.declaration.render) {
    return <div ref={renderRef} />;
  }

  const descriptor = slot.declaration.getDescriptor(info);
  return <ToolCallInlineCard info={info} onOpen={onOpen} descriptor={descriptor} />;
}
