// ── Types ──────────────────────────────────────────────────────────────────────

import { PluginUiAdapter } from "@agent-type";
import type { StreamConfig } from "./streamConfig";
import { BROWSER_SYMBOL } from "./toolSet";
export type { StreamConfig };

/**
 * All configurable launch / context options for a Playwright browser session.
 * Proxy is intentionally excluded — it is controlled separately via `useProxy`.
 * Every field is optional; the backend applies sensible defaults for anything omitted.
 */
export interface BrowserLaunchConfig {
  /**
   * Run in headless mode (no visible window).
   * Browsers are launched headless by default.  Set to `false` only when
   * the target website detects headless mode (bot-detection, CAPTCHA, etc.).
   * @default true
   */
  headless?: boolean;

  /**
   * Custom User-Agent string sent with every request.
   * @default 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …'
   */
  userAgent?: string;

  /**
   * Initial viewport size.
   * @default { width: 1280, height: 720 }
   */
  viewport?: { width: number; height: number };

  /**
   * Chromium command-line flags appended AFTER the built-in defaults.
   * Example: ['--disable-gpu', '--force-dark-mode']
   * @default []
   */
  extraArgs?: string[];

  /**
   * Accept-Language / navigator.language value.
   * @default 'zh-CN,zh;q=0.9,en;q=0.8'
   */
  locale?: string;

  /**
   * IANA timezone identifier, e.g. 'Asia/Shanghai'.
   * @default 'Asia/Shanghai'
   */
  timezoneId?: string;

  /**
   * Whether to ignore HTTPS certificate errors (e.g. self-signed or SM2 certs).
   * @default true
   */
  ignoreHTTPSErrors?: boolean;

  /**
   * Geolocation coordinates to expose to pages.
   * Requires the 'geolocation' permission to be granted.
   */
  geolocation?: { latitude: number; longitude: number; accuracy?: number };

  /**
   * Permissions to grant automatically.
   * @example ['geolocation', 'notifications', 'camera', 'microphone']
   */
  permissions?: string[];

  /**
   * Color scheme emulation.
   * @default 'light'
   */
  colorScheme?: "light" | "dark" | "no-preference";

  /**
   * Approximate device scale factor (DPR).
   * @default 1
   */
  deviceScaleFactor?: number;

  /**
   * Whether to emulate a touch device.
   * @default false
   */
  hasTouch?: boolean;

  /**
   * Whether to emulate a mobile browser (meta-viewport, touch, etc.).
   * @default false
   */
  isMobile?: boolean;

  /**
   * Automatically accept all file downloads instead of cancelling them.
   * Must be `true` for `downloadsPath` to have any effect.
   * @default true
   */
  acceptDownloads?: boolean;

  /**
   * Directory where downloaded files are saved.
   * When omitted Playwright uses a temporary folder that is deleted when the
   * browser closes; set an absolute path to make downloads persistent.
   * Requires `acceptDownloads: true`.
   * @example 'C:/Users/you/Downloads/browser'
   */
  downloadsPath?: string;

  /**
   * Bypass Content-Security-Policy headers.
   * Useful for pages that block inline scripts, eval, or cross-origin requests.
   * @default false
   */
  bypassCSP?: boolean;

  /**
   * Enable or disable JavaScript execution on every page in this context.
   * @default true
   */
  javaScriptEnabled?: boolean;

  /**
   * Emulate offline network conditions (no connectivity).
   * The browser will fail all network requests as if it has no internet.
   * @default false
   */
  offline?: boolean;

  /**
   * HTTP Basic / Digest authentication credentials sent automatically
   * when the server issues a 401 Unauthorized challenge.
   */
  httpCredentials?: { username: string; password: string };

  /**
   * Path to a Playwright storage-state JSON file (cookies + localStorage).
   * Generate it once with `context.storageState({ path: 'state.json' })` to
   * reuse an authenticated session across restarts.
   * @example '/workspace/auth/state.json'
   */
  storageState?: string;

  /**
   * Slow down every Playwright operation by this many milliseconds.
   * Useful for visual debugging — set to 0 for normal speed.
   * @default 0
   */
  slowMo?: number;

  /**
   * Automatically open Chrome DevTools when each page opens.
   * Only effective when `headless` is `false`.
   * @default false
   */
  devtools?: boolean;

  /**
   * Browser distribution channel to launch instead of the default Chromium build.
   * The specified browser must be installed on the host machine.
   * @example 'chrome' | 'msedge' | 'chrome-beta' | 'msedge-beta' | 'chrome-dev' | 'msedge-dev' | 'chrome-canary' | 'msedge-canary'
   */
  channel?: string;
}

/** Metadata for a single page (tab) within a browser session. */
export interface BrowserTabInfo {
  /** Zero-based index of this tab within the session. */
  index: number;
  /** Current page URL, or `null` before first navigation. */
  url: string | null;
  /** Page title, or `null` if not yet available. */
  title: string | null;
}

/** Metadata for a single browser session instance. */
export interface BrowserEntry {
  /** Stable unique identifier. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Whether the browser process is still alive. */
  alive: boolean;
  /** Current page URL of the active tab, or null before first navigation. */
  url: string | null;
  /** ISO-8601 timestamp of when this session was created. */
  createdAt: string;
  /** Total bytes of console output accumulated so far. */
  outputBytes: number;
  /** Playwright viewport dimensions. */
  viewport: { width: number; height: number };
  /** Whether this session was launched with the global proxy enabled. */
  useProxy: boolean;
  /** All tabs open in this session. */
  tabs: BrowserTabInfo[];
  /** Index of the currently active (streaming) tab. */
  activeTabIndex: number;
  /** Active launch/context configuration (excluding proxy). */
  launchConfig: BrowserLaunchConfig;
}

// ── Live-stream types ─────────────────────────────────────────────────────────

/**
 * Input events sent from the browser UI to the backend via the stream WebSocket.
 * All x/y coordinates are normalised to [0, 1] relative to the viewport.
 */
export type BrowserInputMouseMove = { type: "mousemove"; x: number; y: number };
export type BrowserInputMouseDown = {
  type: "mousedown";
  button: number;
  x: number;
  y: number;
};
export type BrowserInputMouseUp = {
  type: "mouseup";
  button: number;
  x: number;
  y: number;
};
export type BrowserInputWheel = {
  type: "wheel";
  deltaX: number;
  deltaY: number;
};
export type BrowserInputKeyDown = {
  type: "keydown";
  key: string;
  modifiers: string[];
};
export type BrowserInputKeyUp = { type: "keyup"; key: string };
export type BrowserInputType = { type: "type"; text: string };

export type BrowserInputEvent =
  | BrowserInputMouseMove
  | BrowserInputMouseDown
  | BrowserInputMouseUp
  | BrowserInputWheel
  | BrowserInputKeyDown
  | BrowserInputKeyUp
  | BrowserInputType;

/**
 * JSON messages sent from the backend to the client over the stream WebSocket.
 * Binary messages (JPEG frames) are sent as ArrayBuffer without a wrapper.
 */
export type BrowserStreamInfo = {
  type: "info";
  url: string | null;
  title: string | null;
  /** Full console buffer — sent once on connect. */
  consoleOutput?: string;
  /** New console lines since last info message. */
  consoleAppend?: string;
  /** Full tab list — sent on connect and whenever tabs change. */
  tabs?: BrowserTabInfo[];
  /** Index of the currently active tab — sent together with `tabs`. */
  activeTabIndex?: number;
};
export type BrowserStreamError = { type: "error"; message: string };
export type BrowserStreamMessage = BrowserStreamInfo | BrowserStreamError;

/** Incremental console log output — analogous to TerminalOutput. */
export interface BrowserOutput {
  /** Console lines since `fromOffset`. */
  output: string;
  /**
   * Pass as `fromOffset` in the next `readOutput()` call for incremental reads.
   * Analogous to the terminal offset cursor.
   */
  offset: number;
}

/** Result of a navigate() call. */
export interface BrowserNavigateResult {
  url: string;
  title: string;
}

/**
 * Text-only page state snapshot returned to the AI.
 * Intentionally does NOT include a screenshot — base64 in tool results is
 * just noise to the LLM.  Screenshots are served separately via the
 * `/api/browser/:id/screenshot` endpoint for the human-facing UI.
 */
export interface BrowserSnapshotResult {
  url: string;
  title: string;
  /** Accumulated console output from the beginning of the buffer. */
  consoleOutput: string;
  /** Absolute buffer offset (for subsequent `readOutput()` calls). */
  outputOffset: number;
  /** All tabs open in this session. Use the `index` field with browser_switch_tab. */
  tabs: BrowserTabInfo[];
  /** Zero-based index of the currently active (visible) tab. */
  activeTabIndex: number;
}

/** Result of a wait() call. */
export interface BrowserWaitResult {
  satisfied: boolean;
  /** Human-readable description of the condition that was met. */
  condition: string;
}

// ── Network recording types ───────────────────────────────────────────────────

/**
 * Playwright resource type values that can appear in a NetworkEntry.
 * Matches the `ResourceType` enum used by Playwright internally.
 */
export type NetworkResourceType =
  | "document"
  | "stylesheet"
  | "image"
  | "media"
  | "font"
  | "script"
  | "texttrack"
  | "xhr"
  | "fetch"
  | "eventsource"
  | "websocket"
  | "manifest"
  | "other";

/** A single captured HTTP network request/response pair. */
export interface NetworkEntry {
  /** Monotonic global id (cross-tab).  Use as cursor for `afterId` pagination. */
  id: number;
  /** Zero-based tab index this entry belongs to. */
  tabIndex: number;
  /** Unix timestamp (ms) when the request was initiated. */
  timestamp: number;
  /** HTTP method, e.g. `'GET'`, `'POST'`. */
  method: string;
  /** Full request URL. */
  url: string;
  /** Playwright resource type. */
  resourceType: NetworkResourceType;
  /** HTTP response status code, or `null` if no response was received. */
  status: number | null;
  /** HTTP response status text, or `null` if no response was received. */
  statusText: string | null;
  /** Round-trip duration in milliseconds, or `null` if the request is still in-flight. */
  duration: number | null;
  /** Request headers (only populated when `includeHeaders` is `true`). */
  requestHeaders: Record<string, string> | null;
  /** Response headers (only populated when `includeHeaders` is `true`). */
  responseHeaders: Record<string, string> | null;
  /**
   * Request body (POST / PUT / PATCH data), truncated to 64 KB.
   * Only populated when `includeBody` is `true` and the request had a body.
   */
  requestBody: string | null;
  /**
   * Response body for text-type responses (text/\*, application/json, …), truncated to 64 KB.
   * Only populated when `includeBody` is `true`. `null` for binary responses.
   */
  responseBody: string | null;
  /** `true` when `responseBody` was cut at the 64 KB limit. */
  responseBodyTruncated: boolean;
  /** Whether the request failed at the network level (no HTTP response). */
  failed: boolean;
  /** Playwright failure description, or `null` if the request did not fail. */
  failureText: string | null;
}

/** Options accepted by `BrowserAdapter.getNetworkRequests()`. */
export interface NetworkQueryOptions {
  /** Restrict results to this tab (0-based).  Omit to query all tabs. */
  tabIndex?: number;
  /** Maximum entries to return (default 100, max 500). */
  limit?: number;
  /**
   * Cursor-based pagination: only return entries with `id` strictly greater
   * than `afterId`.  Use the `id` of the last entry you received.
   */
  afterId?: number;
  /** Filter by Playwright resource type. */
  resourceType?: NetworkResourceType[];
  /** Substring filter applied to `entry.url`. */
  urlPattern?: string;
  /** Filter by HTTP method, e.g. `['GET', 'POST']` (case-insensitive). */
  methodFilter?: string[];
  /**
   * Include raw request and response headers in each entry.
   * Disabled by default to avoid token waste when headers are not needed.
   * @default false
   */
  includeHeaders?: boolean;
  /**
   * Include request body (POST data) and response body (text content types only,
   * truncated to 64 KB) in each entry.
   * Disabled by default — enable only when you need to inspect payloads.
   * @default false
   */
  includeBody?: boolean;
  /**
   * Only return entries whose HTTP status code is >= this value.
   * Useful for isolating errors, e.g. `statusMin: 400` for all client/server errors.
   * In-flight requests (status === null) are excluded when this is set.
   */
  statusMin?: number;
  /**
   * Only return entries whose HTTP status code is <= this value.
   * Combine with `statusMin` for a range, e.g. `statusMin: 400, statusMax: 499` for 4xx.
   * In-flight requests (status === null) are excluded when this is set.
   */
  statusMax?: number;
  /**
   * Only return entries where the request failed at the network level
   * (connection refused, DNS failure, timeout, etc. — not 4xx/5xx HTTP errors).
   * @default false
   */
  onlyFailed?: boolean;
  /**
   * Only return entries with a round-trip duration >= this value (milliseconds).
   * Useful for finding slow requests. In-flight requests (duration === null) are excluded.
   */
  minDurationMs?: number;
  /**
   * Only return entries with a round-trip duration <= this value (milliseconds).
   * In-flight requests (duration === null) are excluded.
   */
  maxDurationMs?: number;
  /**
   * Case-insensitive substring filter applied to the captured request body and
   * response body of each entry. Only entries where at least one body field
   * contains the keyword are returned.
   * The body is matched against the internally-captured content (up to 64 KB)
   * regardless of the `includeBody` setting.
   */
  bodyKeyword?: string;
  /**
   * Case-insensitive substring filter applied to request and response header
   * names and values. Only entries where at least one header name or value
   * contains the keyword are returned. Requires that headers were captured
   * (headers are always stored internally regardless of `includeHeaders`).
   * Example: `'authorization'` to find all requests that sent an auth header.
   */
  headerKeyword?: string;
  /**
   * Maximum bytes to return for each body field (`requestBody`, `responseBody`)
   * in the result. Useful for previewing large payloads without pulling the full
   * 64 KB. When omitted the full captured content is returned.
   * Setting this will mark `responseBodyTruncated: true` if the body was cut.
   */
  bodyMaxBytes?: number;
}

/** Result shape returned by `BrowserAdapter.getNetworkRequests()`. */
export interface NetworkQueryResult {
  /** Matching entries in ascending `id` (chronological) order. */
  entries: NetworkEntry[];
  /** Total matching entries in the buffer before applying `limit`. */
  totalCount: number;
  /**
   * `true` when more entries exist beyond the returned slice.
   * Use `entries[entries.length - 1].id` as `afterId` to fetch the next page.
   */
  hasMore: boolean;
}

// ── Stream connection types ────────────────────────────────────────────────────

/**
 * A live stream connection to a browser session for real-time preview.
 * The transport mechanism (WebSocket, IPC events, …) is fully encapsulated.
 */
export interface BrowserStreamConnection {
  /** Tear down the stream connection and release resources. */
  close(): void;
  /**
   * Send an input event (mouse move/click, keyboard, wheel, type)
   * to the browser session as if the user were interacting directly.
   */
  send(event: BrowserInputEvent): void;
  /**
   * Update the stream configuration (FPS, JPEG quality) live.
   * Does NOT require reconnecting — the backend applies changes
   * on the next frame tick.
   */
  updateConfig(config: Partial<StreamConfig>): void;
}

/** Callbacks registered with `BrowserAdapter.connectStream()`. */
export interface BrowserStreamCallbacks {
  /**
   * Called when a new binary frame (JPEG) is received from the browser.
   * The `ArrayBuffer` is the raw JPEG bytes — decode it with `createImageBitmap`
   * or similar.
   */
  onFrame: (data: ArrayBuffer | SharedArrayBuffer) => void;
  /** Called when a JSON control message arrives (page info, console, tab list). */
  onMessage: (msg: BrowserStreamMessage) => void;
  /** Called when the connection state changes. */
  onStateChange: (connected: boolean) => void;
}

// ── Adapter interface ──────────────────────────────────────────────────────────

/**
 * Dependency-injection contract for browser tool factories.
 * The default implementation (`createHttpBrowserAdapter`) talks to the
 * Agent SDK backend's `/api/browser` REST endpoints.
 *
 * Every method receives `sessionId` so custom implementations can scope
 * sessions per agent conversation.  The default HTTP adapter ignores it
 * (all sessions are shared at the backend level).
 */
export interface BrowserAdapter {
  /** List all active browser sessions. */
  listSessions(opts: { sessionId: string }): Promise<BrowserEntry[]>;

  /**
   * Launch a new browser session.
   * @param opts.label     Display label.
   * @param opts.headless  Use headless mode (default: true).
   * @param opts.startUrl  URL to navigate to immediately after launch.
   * @param opts.sessionId Agent session id (for scoped implementations).
   */
  createSession(opts: {
    label?: string;
    headless?: boolean;
    startUrl?: string;
    /** Whether to route traffic through the global proxy (default: true). */
    useProxy?: boolean;
    /** Additional launch/context configuration. */
    launchConfig?: BrowserLaunchConfig;
    sessionId: string;
  }): Promise<BrowserEntry>;

  /**
   * Close and remove a browser session.
   * @param id        Browser session id.
   * @param sessionId Agent session id (for scoped implementations).
   */
  closeSession(id: string, sessionId: string): Promise<void>;

  /**
   * Navigate the session's page to a URL.
   * @param opts.waitUntil  Load state to wait for (default: 'domcontentloaded').
   * @param opts.timeout    Max wait in ms (default: 30 000).
   * @param opts.sessionId  Agent session id (for scoped implementations).
   */
  navigate(
    id: string,
    url: string,
    opts: { waitUntil?: string; timeout?: number; sessionId: string },
  ): Promise<BrowserNavigateResult>;

  /**
   * Evaluate an arbitrary JavaScript script in the page context.
   * The script is wrapped in an async IIFE on the backend, so statements,
   * `return`, and top-level `await` all work.
   * @param sessionId Agent session id (for scoped implementations).
   */
  evaluate(id: string, script: string, sessionId: string): Promise<unknown>;

  /**
   * Read buffered console log output since `fromOffset`.
   * Analogous to `TerminalManagerAdapter.readOutput()`.
   * @param sessionId Agent session id (for scoped implementations).
   */
  readOutput(
    id: string,
    fromOffset: number,
    sessionId: string,
  ): Promise<BrowserOutput>;

  /**
   * Return text-only page state (URL + title + console log).
   * Does not include a screenshot.
   * @param sessionId Agent session id (for scoped implementations).
   */
  snapshot(id: string, sessionId: string): Promise<BrowserSnapshotResult>;

  /**
   * Wait for a CSS selector to become visible, or for a load state.
   * @param opts.selector   CSS selector to wait for.
   * @param opts.waitUntil  'networkidle' | 'load'
   * @param opts.timeout    Max wait in ms (default: 10 000).
   * @param opts.sessionId  Agent session id (for scoped implementations).
   */
  wait(
    id: string,
    opts: {
      selector?: string;
      waitUntil?: string;
      timeout?: number;
      sessionId: string;
    },
  ): Promise<BrowserWaitResult>;

  /**
   * Update the launch/context configuration for a running session.
   * The browser restarts and navigates back to its current URL.
   * Returns the updated BrowserEntry.
   */
  setLaunchConfig(
    id: string,
    config: BrowserLaunchConfig,
    sessionId: string,
  ): Promise<BrowserEntry>;

  /**
   * Toggle the proxy on or off for an existing session.
   * The browser will restart and navigate back to its current URL.
   * Returns the updated BrowserEntry.
   */
  setProxy(
    id: string,
    useProxy: boolean,
    sessionId: string,
  ): Promise<BrowserEntry>;

  /**
   * Switch the active (streaming) tab within a session.
   * @param index  Zero-based tab index.
   */
  switchTab(
    id: string,
    index: number,
    sessionId: string,
  ): Promise<BrowserEntry>;

  /**
   * Resize the active page's viewport **without** restarting the browser.
   * Uses Playwright's `page.setViewportSize()` under the hood.
   * Returns the updated BrowserEntry reflecting the new viewport size.
   */
  setViewportSize(
    id: string,
    width: number,
    height: number,
    sessionId: string,
  ): Promise<BrowserEntry>;

  /**
   * Capture a JPEG screenshot of the current page and return it as base64.
   * Intended for the `browser_screenshot` AI tool so the model can see the page.
   * @param id        Browser session id.
   * @param sessionId Agent session id (for scoped implementations).
   */
  screenshotData(
    id: string,
    sessionId: string,
    selector?: string,
  ): Promise<{ data: string; mimeType: string }>;

  /**
   * Open a live stream connection for real-time browser preview (JPEG frames +
   * JSON control messages). Accepts input events (mouse, keyboard, wheel) via
   * the returned `BrowserStreamConnection.send()`.
   *
   * The transport mechanism is fully encapsulated — the HTTP adapter uses
   * WebSocket while the IPC adapter uses Electron IPC push events and `invoke`.
   *
   * @param id        Browser session id.
   * @param callbacks Frame, message, and connection-state callbacks.
   * @param config    Optional initial stream configuration (FPS, quality).
   *                  Omit to use backend defaults (24 FPS, quality 80).
   */
  connectStream(
    id: string,
    callbacks: BrowserStreamCallbacks,
    config?: StreamConfig,
  ): BrowserStreamConnection;

  /**
   * Query HTTP network requests recorded for a browser session.
   * Supports cursor-based pagination via `afterId` and multiple filter axes.
   */
  getNetworkRequests(
    id: string,
    opts: NetworkQueryOptions & { sessionId: string },
  ): Promise<NetworkQueryResult>;

  /**
   * Clear all recorded network entries for a session (or a single tab).
   * Equivalent to pressing the "Clear" button in the browser DevTools Network panel.
   * @param id       Browser session id.
   * @param opts.tabIndex  Clear only this tab (0-based). Omit to clear all tabs.
   * @param opts.sessionId Agent session id.
   */
  clearNetworkRequests(
    id: string,
    opts: { tabIndex?: number; sessionId: string },
  ): Promise<void>;
}

// ── Config ─────────────────────────────────────────────────────────────────────

export interface HttpBrowserAdapterConfig {
  /** Base URL of the backend (default: `'/api'`). */
  baseUrl?: string;
}

// ── Module augmentation ───────────────────────────────────────────────────────
export {};

declare module "@agent-type" {
  interface PluginStateExtension {
    browserAdapter: BrowserAdapter;
  }
}
