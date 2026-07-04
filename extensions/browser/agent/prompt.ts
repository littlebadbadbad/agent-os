/**
 * Prompt primitives for the Browser ToolSet.
 */

import type { SectionId } from '@agent-type';

export const BROWSER_SECTION_ID: SectionId = 'browser';

export const BROWSER_LAUNCH_DESCRIPTION =
  'Launch a Chromium browser session.\n' +
  '\n' +
  'When to use:\n' +
  '- Starting a new browser session for web automation\n' +
  '- Setting up a browser with specific viewport/device config\n' +
  '\n' +
  'Behavior:\n' +
  '- Supports many launch config options (viewport, headless, userAgent, etc.)\n' +
  '- useProxy controls whether traffic routes through the configured proxy\n' +
  '- Returns a session ID for use with other browser tools';

export const BROWSER_NAVIGATE_DESCRIPTION =
  'Navigate the browser to a URL and wait for the page to load.\n' +
  '\n' +
  'When to use:\n' +
  '- Loading a web page for inspection\n' +
  '- Following links or submitting forms\n' +
  '\n' +
  'Behavior:\n' +
  '- For SPA routing, prefer browser_run + browser_wait\n' +
  '- After navigation, user should verify content before proceeding\n' +
  '- Supports waitUntil options: domcontentloaded, load, networkidle';

export const BROWSER_RUN_DESCRIPTION =
  'Run JavaScript in the browser page.\n' +
  '\n' +
  'When to use:\n' +
  '- Reading DOM content, attributes, or computed styles\n' +
  '- Clicking elements, typing values, dispatching events\n' +
  '- Extracting page data or returning computed results\n' +
  '- SPA interactions that don\'t cause full navigation\n' +
  '\n' +
  'Behavior:\n' +
  '- Async IIFE — return and await work\n' +
  '- DOM operations via querySelector/querySelectorAll\n' +
  '- Return JSON-serialisable values only (DOM nodes return {})\n' +
  '- Binary output via __toolAttachments__';

export const BROWSER_READ_DESCRIPTION =
  'Read buffered console output from the browser.\n' +
  '\n' +
  'When to use:\n' +
  '- Checking console.log output from page scripts\n' +
  '- Monitoring JavaScript errors\n' +
  '\n' +
  'Behavior:\n' +
  '- Omit fromOffset to auto-continue from last position\n' +
  '- Pass 0 to re-read from start';

export const BROWSER_SNAPSHOT_DESCRIPTION =
  'Get current URL, title, console output, and open tabs.\n' +
  '\n' +
  'When to use:\n' +
  '- Checking current page state\n' +
  '- Verifying navigation succeeded\n' +
  '- Finding newly opened tabs for switching\n' +
  '\n' +
  'Behavior:\n' +
  '- Returns URL, title, recent console output, and tabs list\n' +
  '- Check tabs[] for new tabs opened by navigation\n' +
  '- Use browser_switch_tab to change active tab';

export const BROWSER_WAIT_DESCRIPTION =
  'Wait for a CSS selector or page load state.\n' +
  '\n' +
  'When to use:\n' +
  '- Waiting for dynamic content to appear\n' +
  '- Waiting for async API calls to complete (networkidle)\n' +
  '\n' +
  'Behavior:\n' +
  '- Returns immediately when condition is satisfied\n' +
  '- Throws 408 on timeout';

export const BROWSER_SCREENSHOT_DESCRIPTION =
  'Take a screenshot of the current page or a specific element.\n' +
  '\n' +
  'When to use:\n' +
  '- Visually verifying page state\n' +
  '- Capturing element states for inspection\n' +
  '\n' +
  'Behavior:\n' +
  '- Returns JPEG image attachment\n' +
  '- Pass selector to capture a specific element';

export const BROWSER_SWITCH_TAB_DESCRIPTION =
  'Switch the active tab by zero-based index.\n' +
  '\n' +
  'When to use:\n' +
  '- After a navigation opened a new tab\n' +
  '- Switching between multiple open tabs\n' +
  '\n' +
  'Behavior:\n' +
  '- Check available tabs via browser_snapshot first';

export const BROWSER_CONFIGURE_DESCRIPTION =
  'Update browser session config (viewport, proxy, etc.) and restart.\n' +
  '\n' +
  'When to use:\n' +
  '- Changing viewport/device emulation mid-session\n' +
  '- Modifying browser behaviour settings\n' +
  '\n' +
  'Behavior:\n' +
  '- Only provided fields are updated\n' +
  '- The browser session is restarted with new config';

export const BROWSER_NETWORK_DESCRIPTION =
  'Query HTTP network requests captured by the browser session.\n' +
  '\n' +
  'When to use:\n' +
  '- Inspecting API calls the page makes (XHR/Fetch)\n' +
  '- Debugging network errors\n' +
  '- Extracting tokens or data from responses\n' +
  '\n' +
  'Behavior:\n' +
  '- Supports pagination via afterId\n' +
  '- Filter by URL pattern, method, status, duration\n' +
  '- Include request/response bodies with includeBody';
