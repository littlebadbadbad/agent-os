/**
 * extensions/browser/ui/identifiers.ts
 *
 * Browser tool-name identification helpers.
 *
 * Copied from agent-UI/components/AgentWidget/chat/toolCards/identifiers.ts
 * and made self-contained for the browser plugin's UI.
 *
 * This file lives INSIDE the browser plugin — R7 (zero "browser" in
 * agent-UI/) does not apply here.
 */

const BROWSER_TOOL_NAMES = new Set([
  'browser_list',
  'browser_launch',
  'browser_close',
  'browser_navigate',
  'browser_run',
  'browser_read',
  'browser_snapshot',
  'browser_wait',
  'browser_screenshot',
  'browser_configure',
  'browser_switch_tab',
  'browser_network',
  'browser_clear_network',
]);

export function isBrowserTool(name: string): boolean {
  return BROWSER_TOOL_NAMES.has(name);
}
