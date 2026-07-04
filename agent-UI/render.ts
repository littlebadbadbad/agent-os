import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import AgentWidget from './components/AgentWidget';
import type { AgentWidgetProps } from './components/AgentWidget';

export type { AgentWidgetProps };

/**
 * Mount the AgentWidget into `container` and return an unmount callback.
 */
export function renderWidget(
  container: HTMLElement,
  props: AgentWidgetProps,
): () => void {
  const root = createRoot(container);
  root.render(createElement(AgentWidget, props));
  return () => root.unmount();
}
