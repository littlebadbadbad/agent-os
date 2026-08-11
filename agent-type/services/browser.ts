/**
 * agent-type/services/browser.ts — Browser service type contract
 *
 * Defines the shape of the `'browser'` service that the browser app
 * registers on the backend host's AppServiceRegistry during activation.
 *
 * Other backend apps (e.g., Skill for web scraping) resolve this service
 * to launch and control browser sessions programmatically — without going
 * through the agent layer or HTTP/IPC transport.
 */

// ── Data types ───────────────────────────────────────────────────────────────

/** Metadata for a single browser session. */
export interface BrowserSessionInfo {
  /** Stable unique identifier. */
  readonly id: string;
  /** Human-readable label. */
  readonly label: string;
  /** Whether the browser is headless. */
  readonly headless: boolean;
  /** The most recently navigated URL, or null. */
  readonly url: string | null;
  /** Current page title. */
  readonly title: string;
  /** Whether the browser process is alive. */
  readonly running: boolean;
  /** ISO-8601 timestamp of creation. */
  readonly createdAt: string;
}

/** Launch configuration for a browser session. */
export interface BrowserLaunchConfig {
  /** Base viewport width in pixels. */
  readonly width: number;
  /** Base viewport height in pixels. */
  readonly height: number;
  /** User-agent string override, or null for default. */
  readonly userAgent: string | null;
}

/** Parameters for creating a browser session. */
export interface CreateBrowserParams {
  /** Custom display label. */
  readonly label?: string;
  /** Run headless (default: true). */
  readonly headless?: boolean;
  /** URL to navigate to immediately after launch. */
  readonly startUrl?: string;
  /** Route through proxy if configured. */
  readonly useProxy?: boolean;
  /** Launch-time browser configuration (viewport, user-agent, etc.). */
  readonly launchConfig?: Partial<BrowserLaunchConfig>;
}

/** Parameters for navigating a browser session. */
export interface NavigateParams {
  /** Browser session id. */
  readonly id: string;
  /** URL to navigate to. */
  readonly url: string;
  /** Navigation wait strategy. */
  readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Navigation timeout in milliseconds. */
  readonly timeout?: number;
}

/** Result of a navigation operation. */
export interface NavigateResult {
  /** The final URL after any redirects. */
  readonly url: string;
  /** Page title after navigation. */
  readonly title: string;
}

/** Parameters for evaluating JavaScript in a browser. */
export interface EvaluateParams {
  /** Browser session id. */
  readonly id: string;
  /** JavaScript code to evaluate in the page context. */
  readonly script: string;
}

/** Parameters for reading console output. */
export interface ReadOutputParams {
  /** Browser session id. */
  readonly id: string;
  /** Byte offset to read from (0 for start). */
  readonly fromOffset?: number;
}

/** Buffered console output snapshot. */
export interface ReadOutputResult {
  /** Console output text since `fromOffset`. */
  readonly output: string;
  /** Next offset for incremental reads. */
  readonly offset: number;
}

/** Parameters for taking a page snapshot. */
export interface SnapshotParams {
  /** Browser session id. */
  readonly id: string;
}

/** Accessibility snapshot result. */
export interface SnapshotResult {
  /** Page title. */
  readonly title: string;
  /** Page URL. */
  readonly url: string;
  /** Structured accessibility tree text. */
  readonly content: string;
}

/** Parameters for waiting on a page condition. */
export interface WaitParams {
  /** Browser session id. */
  readonly id: string;
  /** CSS selector to wait for. */
  readonly selector?: string;
  /** Event-based wait strategy. */
  readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  /** Maximum time to wait in milliseconds. */
  readonly timeout?: number;
}

/** Result of a wait operation. */
export interface WaitResult {
  /** Whether the wait succeeded. */
  readonly ok: boolean;
  /** Reason if the wait failed. */
  readonly reason?: string;
}

/** Parameters for taking a screenshot. */
export interface ScreenshotParams {
  /** Browser session id. */
  readonly id: string;
  /** Optional CSS selector to screenshot a specific element. */
  readonly selector?: string;
}

/** Base64-encoded screenshot result. */
export interface ScreenshotResult {
  /** Base64-encoded image data. */
  readonly data: string;
  /** Image MIME type. */
  readonly mimeType: string;
}

/** Parameters for setting launch configuration on a running browser. */
export interface SetLaunchConfigParams {
  /** Browser session id. */
  readonly id: string;
  /** Launch configuration to apply. */
  readonly config: Partial<BrowserLaunchConfig>;
}

/** Parameters for toggling proxy on a browser session. */
export interface SetProxyParams {
  /** Browser session id. */
  readonly id: string;
  /** Whether to enable proxy routing. */
  readonly useProxy: boolean;
}

/** Parameters for switching tabs. */
export interface SwitchTabParams {
  /** Browser session id. */
  readonly id: string;
  /** Zero-based tab index. */
  readonly index: number;
}

/** Parameters for setting viewport size. */
export interface SetViewportParams {
  /** Browser session id. */
  readonly id: string;
  /** Viewport width in pixels. */
  readonly width: number;
  /** Viewport height in pixels. */
  readonly height: number;
}

/** Network request query options. */
export interface NetworkQueryOptions {
  /** Filter by URL substring (case-insensitive). */
  readonly urlFilter?: string;
  /** Filter by HTTP method. */
  readonly method?: string;
  /** Maximum number of requests to return. */
  readonly limit?: number;
  /** Only return requests after this timestamp (ISO-8601). */
  readonly since?: string;
}

/** A captured network request/response pair. */
export interface NetworkRequestEntry {
  /** Request URL. */
  readonly url: string;
  /** HTTP method. */
  readonly method: string;
  /** HTTP status code. */
  readonly status: number;
  /** Response body text (truncated). */
  readonly body: string;
  /** ISO-8601 timestamp. */
  readonly timestamp: string;
}

/** Result of a network query. */
export interface NetworkQueryResult {
  /** Matching network requests. */
  readonly requests: readonly NetworkRequestEntry[];
}

// ── Service interface ────────────────────────────────────────────────────────

/**
 * Browser management service exposed by the browser app.
 *
 * Registered as `'browser'` on {@link AppServiceRegistry} during backend
 * activation.  Other backend apps resolve this to launch and control
 * browser sessions without agent-layer overhead.
 */
export interface BrowserService {
  /** List all active browser sessions. */
  listSessions(): { readonly sessions: readonly BrowserSessionInfo[] };

  /** Launch a new browser session. */
  createSession(params: CreateBrowserParams): Promise<BrowserSessionInfo>;

  /** Close and remove a browser session. */
  closeSession(params: { readonly id: string }): void;

  /** Navigate a browser session to a URL. */
  navigate(params: NavigateParams): Promise<NavigateResult>;

  /** Evaluate JavaScript in a browser session's page context. */
  evaluate(params: EvaluateParams): Promise<{ readonly result: unknown }>;

  /** Read buffered console output. */
  readOutput(params: ReadOutputParams): Promise<ReadOutputResult>;

  /** Take an accessibility snapshot of the current page. */
  snapshot(params: SnapshotParams): Promise<SnapshotResult>;

  /** Wait for a page condition (selector, load event, or network idle). */
  wait(params: WaitParams): Promise<WaitResult>;

  /** Capture a screenshot of the current page or an element. */
  screenshotData(params: ScreenshotParams): Promise<ScreenshotResult>;

  /** Update launch configuration on a running browser session. */
  setLaunchConfig(params: SetLaunchConfigParams): Promise<BrowserSessionInfo>;

  /** Toggle proxy for a browser session. */
  setProxy(params: SetProxyParams): Promise<BrowserSessionInfo>;

  /** Switch to a different tab in a browser session. */
  switchTab(params: SwitchTabParams): Promise<BrowserSessionInfo>;

  /** Set the viewport size of a browser session. */
  setViewportSize(params: SetViewportParams): Promise<BrowserSessionInfo>;

  /** Query captured network requests. */
  getNetworkRequests(params: NetworkQueryOptions & { readonly id: string }): Promise<NetworkQueryResult>;

  /** Clear captured network requests. */
  clearNetworkRequests(params: { readonly id: string }): void;
}
