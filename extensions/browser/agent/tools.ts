import { z } from 'zod';
import { defineTool } from '@agent-type';
import type { BrowserAdapter, NetworkResourceType } from './types';
import { safeLaunchConfig } from './safeConfig';

/**
 * Create the browser-management tool set for an agent.
 * Returns `{ tools, getSystemPrompt }` — toolSet uses `getSystemPrompt` for behavioral guidance.
 */
export function createBrowserTools(adapter: BrowserAdapter) {
  // Per-session × per-browser read cursor so the LLM never needs to thread
  // offsets manually.  Key: `${sessionId}:${browserId}`.
  const readCursors = new Map<string, number>();

  // ── browser_list ─────────────────────────────────────────────────────────────

  const browserListTool = defineTool({
    name:  'browser_list',
    group: 'Browser',
    description: 'List active Playwright browser sessions.',
    parameters: z.object({}),
    execute: async (_, context) => ({
      sessions: await adapter.listSessions(),
    }),
  });

  // ── browser_launch ────────────────────────────────────────────────────────────

  const browserLaunchTool = defineTool({
    name:  'browser_launch',
    group: 'Browser',
    description:
      'Launch a Chromium browser session and return its id.\n\n' +
      'launchConfig FIELDS (all optional):\n' +
      '  headless: boolean | userAgent: string | viewport: {width,height} | colorScheme: "light"|"dark"|"no-preference"\n' +
      '  deviceScaleFactor: number | locale: string | timezoneId: string | hasTouch: boolean | isMobile: boolean\n' +
      '  ignoreHTTPSErrors: boolean | bypassCSP: boolean | javaScriptEnabled: boolean | acceptDownloads: boolean\n' +
      '  downloadsPath: string | offline: boolean | httpCredentials: {username,password} | storageState: string\n' +
      '  slowMo: number | devtools: boolean | channel: string | extraArgs: string[] | permissions: string[]\n' +
      '  geolocation: {latitude,longitude,accuracy}',
    parameters: z.object({
      label: z.string().optional().describe('Human-readable label for this session.'),
      startUrl: z.string().optional().describe('URL to navigate to immediately after launch.'),
      useProxy: z.boolean().optional().describe(
        'Route via configured proxy. false=domestic/CN/localhost; true=foreign sites (default true).',
      ),
      launchConfig: z.record(z.string(), z.unknown()).optional().describe(
        'Playwright launch/context config object. See tool description for field reference.',
      ),
    }),
    execute: async ({ label, startUrl, useProxy, launchConfig }, context) =>
      adapter.createSession({
        label, startUrl, useProxy,
        launchConfig: safeLaunchConfig(launchConfig),
      }),
  });

  // ── browser_close ─────────────────────────────────────────────────────────────

  const browserCloseTool = defineTool({
    name:  'browser_close',
    group: 'Browser',
    description: 'Close a browser session and release all its resources. Irreversible.',
    parameters: z.object({
      id: z.string().describe('Session id.'),
    }),
    execute: async ({ id }, context) => {
      await adapter.closeSession(id);
      // Clean up any stored read cursor.
      for (const key of readCursors.keys()) {
        if (key.endsWith(`:${id}`)) readCursors.delete(key);
      }
      return { closed: id };
    },
  });

  // ── browser_navigate ──────────────────────────────────────────────────────────

  const browserNavigateTool = defineTool({
    name:  'browser_navigate',
    group: 'Browser',
    description:
      'Navigate the browser session to a URL and wait for the page to load. ' +
      'Use this for full-page navigations (links, form submissions that cause a redirect). ' +
      'For SPA routing triggered by JS, prefer browser_run + browser_wait instead.\n\n' +
      'VERIFICATION WORKFLOW:\n' +
      '1. If the destination URL is ambiguous or not explicitly provided, call ask_user (type="text") first.\n' +
      '2. After navigation completes, call ask_user (type="confirm") with a message such as ' +
      '"页面已加载，请在浏览器预览中确认内容是否正确，然后点击确认继续” to pause and let ' +
      'the user visually verify the result in the live browser view before you proceed.\n' +
      '3. Only continue after the user confirms.',
    parameters: z.object({
      id: z.string().describe('Session id.'),
      url: z.string().describe('URL to navigate to.'),
      waitUntil: z.enum(['domcontentloaded', 'load', 'networkidle', 'commit']).optional().describe(
        'Load state to await (default: domcontentloaded). Use networkidle for pages with async API calls.',
      ),
      timeout: z.number().int().min(1_000).max(60_000).optional().describe('Max wait in ms (default 30000).'),
    }),
    execute: async ({ id, url, waitUntil, timeout }, context) =>
      adapter.navigate(id, url, { waitUntil, timeout }),
  });

  // ── browser_run ───────────────────────────────────────────────────────────────

  const browserRunTool = defineTool({
    name:  'browser_run',
    group: 'Browser',
    description:
      'Run JavaScript in the browser page (async IIFE). `return` and `await` work.\n\n' +
      'DOM ops: querySelector/querySelectorAll, .click(), .value, dispatchEvent, scrollTo, getComputedStyle.\n' +
      'Return JSON-serialisable values only. DOM nodes → `{}`. No Playwright APIs here.\n\n' +
      'BINARY OUTPUT — use `__toolAttachments__` for binary/file data:\n' +
      '  return { __toolAttachments__: [{ source:"data", kind, mimeType, data, name? }] }\n' +
      '  kind: "image"|"document"|"audio"|"video" | data: raw base64 (no data: prefix)\n' +
      'Examples:\n' +
      '  canvas→PNG:  `const d=document.querySelector("canvas").toDataURL("image/png").split(",")[1]; return {__toolAttachments__:[{source:"data",kind:"image",mimeType:"image/png",data:d,name:"c.png"}]}`\n' +
      '  fetch PDF:   `const b=await fetch("/f.pdf").then(r=>r.arrayBuffer()); const d=btoa(String.fromCharCode(...new Uint8Array(b))); return {__toolAttachments__:[{source:"data",kind:"document",mimeType:"application/pdf",data:d,name:"f.pdf"}]}`',
    parameters: z.object({
      id: z.string().describe('Session id.'),
      script: z.string().describe(
        'JS to run. Use `return` for output. Binary/file data → __toolAttachments__ only.',
      ),
    }),
    execute: async ({ id, script }, context) => {
      const raw = await adapter.evaluate(id, script);
      // Forward __toolAttachments__ returned by the script so binary data
      // (images, documents, etc.) reaches the LLM as proper message attachments.
      if (raw !== null && typeof raw === 'object' && '__toolAttachments__' in (raw as object)) {
        const { __toolAttachments__, ...rest } = raw as Record<string, unknown>;
        return { result: Object.keys(rest).length > 0 ? rest : null, __toolAttachments__ };
      }
      return { result: raw ?? null };
    },
  });

  // ── browser_read ──────────────────────────────────────────────────────────────

  const DEFAULT_MAX_LINES = 100;

  const browserReadTool = defineTool({
    name:  'browser_read',
    group: 'Browser',
    description:
      'Read buffered console output (console.log, errors, page errors). ' +
      'Omit fromOffset to auto-continue from last position; pass 0 to re-read from start. ' +
      `Returns up to ${DEFAULT_MAX_LINES} lines by default.`,
    parameters: z.object({
      id: z.string().describe('Session id.'),
      fromOffset: z.number().int().min(0).optional().describe(
        'Byte offset override. Omit to auto-continue; 0 to re-read from start.',
      ),
      maxLines: z.number().int().min(10).max(2_000).optional().describe(
        `Max lines to return (default ${DEFAULT_MAX_LINES}). Most recent kept when truncating.`,
      ),
    }),
    execute: async ({ id, fromOffset, maxLines }, context) => {
      const cursorKey       = `${context.sessionId}:${id}`;
      const effectiveOffset = fromOffset ?? readCursors.get(cursorKey) ?? 0;
      const result          = await adapter.readOutput(id, effectiveOffset);
      readCursors.set(cursorKey, result.offset);

      const limit = maxLines ?? DEFAULT_MAX_LINES;
      const lines = result.output.split('\n');
      if (lines.length > limit) {
        const skipped = lines.length - limit;
        return {
          ...result,
          output:       lines.slice(-limit).join('\n'),
          truncated:    true,
          linesSkipped: skipped,
        };
      }
      return result;
    },
  });

  // ── browser_snapshot ─────────────────────────────────────────────────────────

  const browserSnapshotTool = defineTool({
    name:  'browser_snapshot',
    group: 'Browser',
    description:
      'Return current URL, title, recent console output, and open tabs list. ' +
      'Check tabs[] for new tabs opened by navigation; use browser_switch_tab to switch.',
    parameters: z.object({
      id: z.string().describe('Session id.'),
    }),
    execute: async ({ id }, context) =>
      adapter.snapshot(id),
  });

  // ── browser_wait ─────────────────────────────────────────────────────────────

  const browserWaitTool = defineTool({
    name:  'browser_wait',
    group: 'Browser',
    description:
      'Wait for a CSS selector to appear in the DOM, or a page load state (networkidle|load). ' +
      'Returns immediately when satisfied; throws 408 on timeout.',
    parameters: z.object({
      id: z.string().describe('Session id.'),
      selector: z.string().optional().describe(
        'CSS selector to wait for, e.g. ".dashboard-loaded".',
      ),
      waitUntil: z.enum(['networkidle', 'load']).optional().describe(
        'networkidle=no requests for 500ms | load=load event fired.',
      ),
      timeout: z.number().int().min(500).max(60_000).optional().describe('Max wait in ms (default 10000).'),
    }),
    execute: async ({ id, selector, waitUntil, timeout }, context) =>
      adapter.wait(id, { selector, waitUntil, timeout }),
  });

  // ── browser_screenshot ───────────────────────────────────────────────────────

  const browserScreenshotTool = defineTool({
    name:  'browser_screenshot',
    group: 'Browser',
    description:
      'Take a JPEG screenshot and return it as an image attachment. ' +
      'Pass selector to capture a specific element only.',
    parameters: z.object({
      id: z.string().describe('Session id.'),
      selector: z.string().optional().describe(
        'CSS selector of element to capture. Omit for full page.',
      ),
    }),
    execute: async ({ id, selector }, context) => {
      const [{ data, mimeType }, snap] = await Promise.all([
        adapter.screenshotData(id, selector),
        adapter.snapshot(id),
      ]);
      return {
        url:   snap.url,
        title: snap.title,
        __toolAttachments__: [
          { source: 'data' as const, kind: 'image' as const, mimeType, data, name: `screenshot-${id}.jpg` },
        ],
      };
    },
  });

  // ── browser_configure ─────────────────────────────────────────────────────────

  const browserConfigureTool = defineTool({
    name:  'browser_configure',
    group: 'Browser',
    description:
      'Update a running browser session’s launch/context config and restart it. ' +
      'Only provided fields are changed; omitted fields keep their current value. ' +
      'Fields: headless, userAgent, viewport, colorScheme, deviceScaleFactor, locale, timezoneId, ' +
      'hasTouch, isMobile, ignoreHTTPSErrors, bypassCSP, javaScriptEnabled, acceptDownloads, ' +
      'downloadsPath, offline, httpCredentials, storageState, slowMo, devtools, channel, extraArgs, ' +
      'permissions, geolocation.',
    parameters: z.object({
      id: z.string().describe('Session id.'),
      launchConfig: z.record(z.string(), z.unknown()).describe(
        'Partial Playwright launch/context config. Only provided fields are updated.',
      ),
    }),
    execute: async ({ id, launchConfig }, context) =>
      adapter.setLaunchConfig(
        id,
        safeLaunchConfig(launchConfig) ?? {},
      ),
  });

  // ── browser_switch_tab ────────────────────────────────────────────────────────

  const browserSwitchTabTool = defineTool({
    name:  'browser_switch_tab',
    group: 'Browser',
    description: 'Switch the active tab by zero-based index. Check tabs[] in browser_snapshot for available indexes.',
    parameters: z.object({
      id: z.string().describe('Session id.'),
      index: z.number().int().min(0).describe('Zero-based tab index.'),
    }),
    execute: async ({ id, index }, context) =>
      adapter.switchTab(id, index),
  });

  // ── browser_network ───────────────────────────────────────────────────────────

  const RESOURCE_TYPES = [
    'document', 'stylesheet', 'image', 'media', 'font', 'script',
    'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other',
  ] as const satisfies readonly NetworkResourceType[];

  const browserNetworkTool = defineTool({
    name:  'browser_network',
    group: 'Browser',
    description:
      'Query HTTP network requests captured for a browser session.\n\n' +
      'Every request made by any page in the session is recorded: document loads, ' +
      'XHR/Fetch API calls, scripts, stylesheets, images, WebSocket upgrades, etc. ' +
      'Use this to inspect what API calls a page makes, debug network errors, or ' +
      'extract tokens/data returned in responses.\n\n' +
      'PAGINATION\n' +
      'Results are ordered by id ascending (chronological). To page forward, pass\n' +
      '  afterId: entries[entries.length - 1].id\n' +
      'in the next call. `hasMore: true` signals more entries exist.\n\n' +
      'BODY CONTENT\n' +
      'Request/response bodies are captured internally for all text-type responses ' +
      '(JSON, HTML, XML, plain text, etc.) up to 64 KB per entry, but are NOT ' +
      'returned by default. Enable them with `includeBody: true`. ' +
      'Use `bodyMaxBytes` to preview just the first N bytes when bodies are large — ' +
      'e.g. `bodyMaxBytes: 512` to read the first 512 characters of each body. ' +
      'Use `bodyKeyword` to filter entries whose body contains a specific substring.\n\n' +
      'COMMON PATTERNS\n' +
      '→ Inspect all API calls:          resourceType: ["xhr", "fetch"]\n' +
      '→ Find a specific endpoint:       urlPattern: "/api/login"\n' +
      '→ See only POST requests:         methodFilter: ["POST"]\n' +
      '→ All errors (HTTP + network):    statusMin: 400  OR  onlyFailed: true\n' +
      '→ Only 5xx server errors:         statusMin: 500, statusMax: 599\n' +
      '→ Slow requests (> 2 s):          minDurationMs: 2000\n' +
      '→ Search body for a token:        bodyKeyword: "access_token", includeBody: true\n' +
      '→ Preview large JSON responses:   includeBody: true, bodyMaxBytes: 1024\n' +
      '→ Read response headers (Set-Cookie, auth): includeHeaders: true\n\n' +
      'NOTE: Binary types (images, video, fonts) are never captured as body text.',
    parameters: z.object({
      id: z.string().describe('Browser session id.'),
      tabIndex: z.number().int().min(0).optional().describe(
        'Restrict to a single tab (0-based). Omit for all tabs.',
      ),
      limit: z.number().int().min(1).max(1000).optional().describe(
        'Max entries to return (default 100). Use afterId for pagination.',
      ),
      afterId: z.number().int().optional().describe(
        'Cursor: return entries with id > afterId for pagination.',
      ),
      resourceType: z.array(z.enum(RESOURCE_TYPES)).optional().describe(
        'Filter by Playwright resource type, e.g. ["xhr","fetch"] for API calls.',
      ),
      urlPattern: z.string().optional().describe('Substring filter on request URL.'),
      methodFilter: z.array(z.string()).optional().describe('Filter by HTTP method, e.g. ["GET","POST"].'  ),
      includeHeaders: z.boolean().optional().describe(
        'Include raw request/response headers (default false). Useful for cookies, auth tokens.',
      ),
      includeBody: z.boolean().optional().describe(
        'Include request and response bodies (default false). Text content types only; up to 64KB per entry.',
      ),
      statusMin: z.number().int().min(100).max(599).optional().describe(
        'Only entries with HTTP status >= this value (e.g. 400 for all errors).',
      ),
      statusMax: z.number().int().min(100).max(599).optional().describe(
        'Only entries with HTTP status <= this value. Combine with statusMin for a range.',
      ),
      onlyFailed: z.boolean().optional().describe(
        'Only requests that failed at network level (connection refused, DNS, timeout).',
      ),
      minDurationMs: z.number().int().min(0).optional().describe(
        'Only entries with round-trip duration >= this value (ms). Useful for slow request detection.',
      ),
      maxDurationMs: z.number().int().min(0).optional().describe(
        'Only entries with round-trip duration <= this value (ms).',
      ),
      bodyKeyword: z.string().optional().describe(
        'Case-insensitive substring filter: only entries whose request or response body contains this keyword.',
      ),
      headerKeyword: z.string().optional().describe(
        'Case-insensitive substring filter on header names/values.',
      ),
      bodyMaxBytes: z.number().int().min(1).max(65536).optional().describe(
        'Limit returned body text to this many bytes per entry. Sets responseBodyTruncated=true when cut.',
      ),
    }),
    execute: async ({ id, ...opts }, context) =>
      adapter.getNetworkRequests(id, { ...opts }),
  });

  // ── browser_clear_network ──────────────────────────────────────────────────────────────

  const browserClearNetworkTool = defineTool({
    name:  'browser_clear_network',
    group: 'Browser',
    description:
      'Clear all recorded network entries for a browser session (resets the log). ' +
      'Use before triggering an action to get a clean log of only new requests.',
    parameters: z.object({
      id: z.string().describe('Browser session id.'),
      tabIndex: z.number().int().min(0).optional().describe(
        'Clear only this tab (0-based). Omit to clear all tabs.',
      ),
    }),
    execute: async ({ id, tabIndex }, context) => {
      await adapter.clearNetworkRequests(id, { tabIndex });
      return { cleared: true, tabIndex: tabIndex ?? 'all' };
    },
  });

  return {
    tools: [
      browserListTool,
      browserLaunchTool,
      browserCloseTool,
      browserNavigateTool,
      browserRunTool,
      browserReadTool,
      browserSnapshotTool,
      browserWaitTool,
      browserScreenshotTool,
      browserSwitchTabTool,
      browserConfigureTool,
      browserNetworkTool,
      browserClearNetworkTool,
    ] as const,
    getSystemPrompt: () =>
      '## Browser\n' +
      'Proxy: domestic/CN sites (*.cn, Baidu, Taobao, Bilibili, etc.) \u2192 useProxy:false | ' +
      'foreign (Google, GitHub, YouTube, etc.) \u2192 useProxy:true | localhost \u2192 useProxy:false\n' +
      'After browser_navigate or browser_run: call ask_user(type="confirm") to let user verify before proceeding.\n' +
      'Before scripts that submit/delete/modify content: call ask_user(type="confirm").\n' +
      'New tabs: check tabs[] in browser_snapshot; use browser_switch_tab to switch.',
  };
}
