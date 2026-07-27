/**
 * BrowserInstance — a single Playwright-backed browser session.
 *
 * Analogous to TerminalInstance:
 *   - Wraps a Playwright Browser + Page
 *   - Maintains a console-log ring buffer (page console + pageerror events)
 *   - `read(fromOffset)` returns buffered output for incremental polling
 *   - `evaluate(script)` runs arbitrary JS in the page context
 *   - `snapshot()` returns URL + title + recent console (screenshot via
 *     the dedicated /screenshot endpoint, not via the AI tool)
 */

/** @import { Browser, Page, BrowserContext, BrowserContextOptions } from 'playwright' */
/** @import { WebSocket } from 'ws' */
/** @import { WebContents } from 'electron' */
/** @import { NetworkEntry } from './network-recorder.js' */

const DEFAULT_MAX_BUF = 500 * 1024; // 500 KB

import { createRequire } from 'module';
import { join, dirname } from 'path';
import { getProxy } from '../../proxy-host.js';
import { NetworkRecorder } from './network-recorder.js';

// In pkg mode playwright is kept on disk next to the versioned exe (not
// compiled into the snapshot) so playwright-core can locate its Chromium
// binary via real filesystem paths.  We load it with an absolute disk path
// so pkg routes the require to the real filesystem, not the snapshot.
//
// In dev mode the backend is compiled to plugins/browser/backend.cjs, but
// playwright lives in the extension's own node_modules.  We use
// createRequire with a path relative to the bundle's __dirname to reach it.
const _loadPlaywright = typeof process.pkg !== 'undefined'
  ? () => createRequire(join(dirname(process.execPath), '_'))('playwright')
  : () => {
      const bundleDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
      const extRequire = createRequire(join(bundleDir, '..', '..', 'extensions', 'browser', 'noop.js'));
      return extRequire('playwright');
    };

/**
 * @typedef {{ index: number; url: string|null; title: string|null }} TabInfo
 */

/**
 * Default launch configuration applied when no override is provided.
 * Headless is true by default — set to false only when the target website
 * detects headless mode (bot-detection, CAPTCHA, etc.).
 * All fields correspond to BrowserLaunchConfig fields in types.ts.
 */
const DEFAULT_LAUNCH_CONFIG = Object.freeze({
  headless:          true,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36',
  viewport:          { width: 1280, height: 720 },
  extraArgs:         [],
  locale:            'zh-CN,zh;q=0.9,en;q=0.8',
  timezoneId:        'Asia/Shanghai',
  ignoreHTTPSErrors: true,
  colorScheme:       'light',
  deviceScaleFactor: 1,
  hasTouch:          false,
  isMobile:          false,
  geolocation:       undefined,
  permissions:       [],
  // ── Download options ──────────────────────────────────────────────────────
  acceptDownloads:   true,
  downloadsPath:     undefined,
  // ── Page / context flags ──────────────────────────────────────────────────
  bypassCSP:         false,
  javaScriptEnabled: true,
  offline:           false,
  httpCredentials:   undefined,
  storageState:      undefined,
  // ── Launch-level options ──────────────────────────────────────────────────
  slowMo:            0,
  devtools:          false,
  channel:           undefined,
});

/**
 * Merge a partial config with the defaults.
 * @param {Partial<typeof DEFAULT_LAUNCH_CONFIG>} [partial]
 * @returns {typeof DEFAULT_LAUNCH_CONFIG}
 */
function mergeConfig(partial = {}) {
  return { ...DEFAULT_LAUNCH_CONFIG, ...partial };
}

export class BrowserInstance {
  #id;
  #label;
  #useProxy;
  /**
   * Merged launch configuration (defaults + user overrides).
   * Excludes proxy — that is controlled by #useProxy separately.
   * @type {typeof DEFAULT_LAUNCH_CONFIG}
   */
  #launchConfig;
  /** @type {Browser|null} */
  #browser  = null;
  /** @type {BrowserContext|null} */
  #context  = null;
  /**
   * All pages (tabs) open in this session.
   * Index 0 is always the first tab opened at launch.
   * @type {Page[]}
   */
  #pages    = [];
  /** Index into #pages of the currently active (visible/streaming) tab. */
  #activeTabIndex = 0;
  #maxBuf   = DEFAULT_MAX_BUF;
  /**
   * Per-page console log buffers.
   * Each page gets its own buffer so console output is isolated by tab.
   * @type {Map<Page, { buf: string; absOffset: number }>}
   */
  #pageBufs = new Map();
  #alive    = false;
  #createdAt = new Date().toISOString();
  /**
   * Listeners notified whenever the tab list or active tab index changes.
   * Used by startStreaming() to push real-time tab-change events to WS clients.
   * @type {Set<() => void>}
   */
  #tabChangeListeners = new Set();
  /**
   * Per-page network recorders.  Keyed by the Playwright Page object itself so
   * the correct recorder is always found regardless of tab reordering.
   * @type {Map<Page, NetworkRecorder>}
   */
  #networkRecorders = new Map();
  /**
   * Monotonically-increasing counter shared across all tabs so that afterId
   * cursor pagination works correctly in cross-tab queries.
   */
  #globalNetworkId = 0;

  /**
   * Live stream configuration (FPS, JPEG quality).
   * Updated live via `updateStreamConfig()` — the streaming thread picks up
   * changes on its next tick without restarting the browser.
   * @type {{ fps: number; quality: number }}
   */
  #streamConfig = { fps: 24, quality: 80 };
  /** @type {ReturnType<setInterval>|null} */
  #streamTimerId = null;

  /**
   * @param {string} id
   * @param {{ label?: string; useProxy?: boolean; launchConfig?: Partial<typeof DEFAULT_LAUNCH_CONFIG> }} [opts]
   */
    constructor(id, { label, useProxy = true, launchConfig } = {}) {
    this.#id           = id;
    this.#label        = label ?? 'browser';
    this.#useProxy     = useProxy;
    this.#launchConfig = mergeConfig(launchConfig);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** The currently active Playwright Page, or null if not yet launched. */
  get #activePage() {
    return this.#pages[this.#activeTabIndex] ?? null;
  }

  /**
   * Wire console/error/close listeners onto a newly created page.
   * Each page gets its own isolated console buffer.
   * @param {Page} page
   */
  #hookPage(page) {
    // Create per-page console buffer.
    this.#pageBufs.set(page, { buf: '', absOffset: 0 });

    page.on('console', (msg) => {
      this.#appendLog(page, `[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      this.#appendLog(page, `[pageerror] ${err.message}`);
    });
    page.on('download', (download) => {
      this.#appendLog(page, `[download] ${download.suggestedFilename()} ← ${download.url()}`);
    });
    page.on('close', () => {
      // Clean up per-page resources.
      this.#networkRecorders.get(page)?.stop();
      this.#networkRecorders.delete(page);
      this.#pageBufs.delete(page);
      // Remove from page list; keep active index in bounds.
      this.#pages = this.#pages.filter(p => p !== page);
      if (this.#activeTabIndex >= this.#pages.length) {
        this.#activeTabIndex = Math.max(0, this.#pages.length - 1);
      }
      if (this.#pages.length === 0) {
        this.#alive = false;
      }
      this.#notifyTabsChanged();
    });

    // Attach a network recorder to this page.  tabIndex is the current index
    // at hook time; it is stored inside the entry and used only for filtering.
    const tabIndex = this.#pages.indexOf(page);
    const recorder = new NetworkRecorder(page, {
      tabIndex: tabIndex === -1 ? 0 : tabIndex,
      getNextId: () => this.#globalNetworkId++,
    });
    this.#networkRecorders.set(page, recorder);
  }

  /** Notify all active WS streams that the tab list has changed. */
  #notifyTabsChanged() {
    for (const listener of this.#tabChangeListeners) listener();
  }

  /**
   * Build a synchronous snapshot of all tabs (title is best-effort from
   * the last known value; see #getTabListAsync for accurate titles).
   * @returns {TabInfo[]}
   */
  #getTabList() {
    return this.#pages.map((p, i) => ({
      index: i,
      url:   p.url() || null,
      title: null, // async — not available synchronously
    }));
  }

  /**
   * Build the tab list, fetching titles asynchronously.
   * @returns {Promise<TabInfo[]>}
   */
  async #getTabListAsync() {
    return Promise.all(
      this.#pages.map(async (p, i) => ({
        index: i,
        url:   p.url() || null,
        title: await p.title().catch(() => null),
      })),
    );
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /**
   * Launch the Playwright browser and optionally navigate to a start URL.
   * Must be called once before using any other method.
   * @param {string} [startUrl]
   */
  async launch(startUrl) {
    const { chromium } = await _loadPlaywright();
    const proxyCfg = getProxy();
    const cfg = this.#launchConfig;

    const builtInArgs = [
      '--ignore-certificate-errors',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ];

    const launchOpts = {
      headless: cfg.headless,
      args: [...builtInArgs, ...(cfg.extraArgs ?? [])],
      ...(cfg.slowMo   ? { slowMo:   cfg.slowMo }   : {}),
      ...(cfg.devtools ? { devtools: cfg.devtools }  : {}),
      ...(cfg.channel  ? { channel:  cfg.channel }   : {}),
    };
    if (this.#useProxy) {
      launchOpts.proxy = {
        server: `${proxyCfg.protocol}://${proxyCfg.host}:${proxyCfg.port}`,
        ...(proxyCfg.username ? { username: proxyCfg.username, password: proxyCfg.password } : {}),
      };
    }
    this.#browser = await chromium.launch(launchOpts);

    /** @type {BrowserContextOptions} */
    const ctxOpts = {
      userAgent:         cfg.userAgent,
      viewport:          cfg.viewport ?? null,
      locale:            cfg.locale,
      timezoneId:        cfg.timezoneId,
      ignoreHTTPSErrors: cfg.ignoreHTTPSErrors,
      colorScheme:       cfg.colorScheme,
      deviceScaleFactor: cfg.deviceScaleFactor,
      hasTouch:          cfg.hasTouch,
      isMobile:          cfg.isMobile,
      acceptDownloads:   cfg.acceptDownloads ?? true,
      bypassCSP:         cfg.bypassCSP ?? false,
      javaScriptEnabled: cfg.javaScriptEnabled ?? true,
      offline:           cfg.offline ?? false,
    };
    if (cfg.geolocation)     ctxOpts.geolocation     = cfg.geolocation;
    if (cfg.downloadsPath)   ctxOpts.downloadsPath   = cfg.downloadsPath;
    if (cfg.httpCredentials) ctxOpts.httpCredentials = cfg.httpCredentials;
    if (cfg.storageState)    ctxOpts.storageState    = cfg.storageState;

    this.#context = await this.#browser.newContext(ctxOpts);

    // Grant any requested permissions.
    if (cfg.permissions?.length) {
      await this.#context.grantPermissions(cfg.permissions);
    }

    this.#pages = [];
    this.#activeTabIndex = 0;

    // Listen for new pages opened by the page itself (target="_blank", window.open, etc.)
    // Auto-switch to the new tab so the stream follows the user's natural flow.
    this.#context.on('page', (newPage) => {
      this.#pages.push(newPage);
      this.#activeTabIndex = this.#pages.length - 1;
      this.#hookPage(newPage);
      // Wait for the new page to have a real URL before broadcasting.
      newPage.waitForLoadState('domcontentloaded').catch(() => {}).then(() => {
        this.#notifyTabsChanged();
      });
    });

    const firstPage = await this.#context.newPage();
    this.#pages = [firstPage];
    this.#hookPage(firstPage);
    this.#alive = true;

    if (startUrl) {
      await firstPage.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
  }

  /** Close the browser and free all resources. */
  async close() {
    this.#alive = false;
    // Stop all recorders before clearing the page list.
    for (const recorder of this.#networkRecorders.values()) recorder.stop();
    this.#networkRecorders.clear();
    this.#globalNetworkId = 0;
    this.#pages = [];
    try { await this.#browser?.close(); } catch { /* ignore */ }
    this.#context = null;
    this.#browser = null;
  }

  /**
   * Toggle the proxy on or off for this session.
   * Restarts the browser (required — proxy is a Playwright launch-time option)
   * and navigates back to the active tab's URL.
   * Any active WebSocket stream will disconnect and must reconnect.
   * @param {boolean} v
   */
  async setUseProxy(v) {
    if (this.#useProxy === v) return;
    this.#useProxy = v;
    if (!this.#alive) return;
    const prevUrl = this.#activePage?.url();
    const resumeUrl = prevUrl && !prevUrl.startsWith('about:') ? prevUrl : undefined;
    await this.close();
    await this.launch(resumeUrl);
  }

  /**
   * Update the launch / context configuration and restart the browser.
   * Partial updates are supported — only the provided keys are overwritten.
   * Any active WebSocket stream will disconnect and must reconnect.
   * @param {Partial<typeof DEFAULT_LAUNCH_CONFIG>} partial
   */
  async setLaunchConfig(partial) {
    this.#launchConfig = mergeConfig({ ...this.#launchConfig, ...partial });
    if (!this.#alive) return; // config stored; will take effect on next launch()
    const prevUrl = this.#activePage?.url();
    const resumeUrl = prevUrl && !prevUrl.startsWith('about:') ? prevUrl : undefined;
    await this.close();
    await this.launch(resumeUrl);
  }

  /**
   * Switch the active (streamed) tab to the given index.
   * Notifies all active WS streams so the frame source changes immediately.
   * @param {number} index  Zero-based index into the open pages list.
   */
  async switchTab(index) {
    if (index < 0 || index >= this.#pages.length) {
      throw new Error(
        `Tab index ${index} out of range — session has ${this.#pages.length} tab(s) (0–${this.#pages.length - 1})`,
      );
    }
    this.#activeTabIndex = index;
    this.#notifyTabsChanged();
  }

  // ── Live stream config (no restart needed) ───────────────────────────────────

  /**
   * Update the live stream configuration (FPS, JPEG quality).
   * The streaming thread picks up changes on its next tick.
   * Does NOT restart the browser — effects are immediate.
   *
   * @param {{ fps?: number; quality?: number }} partial
   */
  updateStreamConfig(partial) {
    if (partial.fps !== undefined) {
      this.#streamConfig.fps = Math.max(1, Math.min(60, Math.round(partial.fps)));
    }
    if (partial.quality !== undefined) {
      this.#streamConfig.quality = Math.max(10, Math.min(100, Math.round(partial.quality)));
    }
    // Note: FPS / quality changes do NOT restart the interval timer here
    // because #streamTick requires closure-captured `io` and `state`
    // arguments that are only available inside #runStreamLoop.
    //
    // Quality is read from this.#streamConfig on every tick, so the new
    // value takes effect on the very next frame — no restart needed.
    // FPS changes take effect when the stream is stopped and restarted
    // (closing the panel / switching sessions).
  }

  /**
   * Resize the active page's viewport **without** restarting the browser.
   * Uses Playwright's native `page.setViewportSize()`.
   * Notifies all stream listeners so the client can update its canvas size.
   *
   * @param {number} width
   * @param {number} height
   */
  async setViewportSize(width, height) {
    this.#assertAlive();
    await this.#activePage.setViewportSize({ width, height });
    this.#notifyTabsChanged();
  }

  // ── Operations ───────────────────────────────────────────────────────────────

  /**
   * Navigate to a URL and wait for the page to reach the given load state.
   * @param {string} url
   * @param {{ waitUntil?: 'domcontentloaded'|'load'|'networkidle'|'commit'; timeout?: number }} [opts]
   * @returns {Promise<{ url: string; title: string }>}
   */
  async navigate(url, { waitUntil = 'domcontentloaded', timeout = 30_000 } = {}) {
    this.#assertAlive();
    await this.#activePage.goto(url, { waitUntil, timeout });
    return { url: this.#activePage.url(), title: await this.#activePage.title() };
  }

  /**
   * Evaluate arbitrary JavaScript in the page context.
   *
   * The script is wrapped in an async IIFE so statements, `return`, and
   * top-level `await` all work as expected:
   *
   *   "return document.title"
   *   "document.querySelector('#btn').click()"
   *   "const el = document.querySelector('input'); el.value = 'hi'; return el.value"
   *
   * Return values must be JSON-serialisable (primitives, plain objects, arrays).
   * DOM nodes or class instances will be serialised to `{}` by Playwright.
   *
   * @param {string} script
   * @returns {Promise<unknown>}
   */
  async evaluate(script) {
    this.#assertAlive();
    const wrapped = `(async () => { ${script} })()`;
    try {
      return await this.#activePage.evaluate(wrapped);
    } catch (err) {
      throw new Error(`evaluate failed: ${err.message}`);
    }
  }

  /**
   * Wait for a CSS selector to become visible, or for a network/load state.
   * @param {{ selector?: string; waitUntil?: 'networkidle'|'load'; timeout?: number }} [opts]
   * @returns {Promise<{ satisfied: boolean; condition: string }>}
   */
  async wait({ selector, waitUntil, timeout = 10_000 } = {}) {
    this.#assertAlive();
    if (selector) {
      await this.#activePage.waitForSelector(selector, { timeout });
      return { satisfied: true, condition: `selector "${selector}" visible` };
    }
    if (waitUntil === 'networkidle') {
      await this.#activePage.waitForLoadState('networkidle', { timeout });
      return { satisfied: true, condition: 'networkidle' };
    }
    if (waitUntil === 'load') {
      await this.#activePage.waitForLoadState('load', { timeout });
      return { satisfied: true, condition: 'load' };
    }
    throw new Error('wait: provide "selector" or "waitUntil" ("networkidle" | "load")');
  }

  /**
   * Take a JPEG screenshot and return it as a Buffer.
   * Kept separate from `snapshot()` so the screenshot can be streamed
   * directly as an image response without involving the AI tool.
   * @param {{ quality?: number }} [opts]
   * @returns {Promise<Buffer>}
   */
  async screenshot({ quality = 60 } = {}) {
    this.#assertAlive();
    return this.#activePage.screenshot({ type: 'jpeg', quality });
  }

  /**
   * Take a JPEG screenshot of a single DOM element matched by a CSS selector.
   * Scrolls the element into view automatically.
   * @param {string} selector  CSS selector, e.g. '#chart', '.card:first-child'
   * @param {{ quality?: number }} [opts]
   * @returns {Promise<Buffer>}
   */
  async elementScreenshot(selector, { quality = 60 } = {}) {
    this.#assertAlive();
    const locator = this.#activePage.locator(selector).first();
    await locator.scrollIntoViewIfNeeded();
    return locator.screenshot({ type: 'jpeg', quality });
  }

  /**
   * @typedef {{ sendBinary(buf: Buffer): void; sendJSON(obj: object): void; isConnected(): boolean; onClose(cb: () => void): void; close(): void }} StreamIO
   */

  /**
   * Internal streaming tick — captures a JPEG frame + sends periodic info.
   * Reads live settings from `this.#streamConfig` (FPS, quality).
   * @param {StreamIO} io
   * @param {{ frameInFlight: boolean; consoleOffset: number; infoTick: number; infoEvery: number }} state
   */
  async #streamTick(io, state) {
    if (!io?.isConnected || !this.#alive) return;

    // Frame — always from the active page
    if (!state.frameInFlight) {
      state.frameInFlight = true;
      try {
        const buf = await this.#activePage.screenshot({
          type: 'jpeg',
          quality: this.#streamConfig.quality,
        });
        if (io.isConnected()) io.sendBinary(buf);
      } catch { /* page closed or navigating */ }
      state.frameInFlight = false;
    }

    // Periodic info message (console + URL/title updates, ~every 2 s)
    state.infoTick++;
    if (state.infoTick >= state.infoEvery) {
      state.infoTick = 0;
      const con = this.read(state.consoleOffset);
      state.consoleOffset = con.offset;
      if (con.output || true) {
        await this.#sendInfo(io, con.output ? { consoleAppend: con.output } : {});
      }
    }
  }

  /**
   * Build and send an info JSON message over the stream IO.
   * @param {StreamIO} io
   * @param {{ consoleOutput?: string; consoleAppend?: string }} [opts]
   */
  async #sendInfo(io, { consoleOutput, consoleAppend } = {}) {
    if (!io.isConnected()) return;
    try {
      const page  = this.#activePage;
      const url   = page?.url() ?? null;
      const title = page ? await page.title().catch(() => null) : null;
      const tabs  = await this.#getTabListAsync();
      /** @type {{ type: string; url: string|null; title: string|null; tabs: TabInfo[]; activeTabIndex: number; consoleOutput?: string; consoleAppend?: string }} */
      const msg   = { type: 'info', url, title, tabs, activeTabIndex: this.#activeTabIndex };
      if (consoleOutput !== undefined) msg.consoleOutput = consoleOutput;
      if (consoleAppend)               msg.consoleAppend = consoleAppend;
      io.sendJSON(msg);
    } catch { /* ignore */ }
  }

  /**
   * Run the streaming loop over a generic `StreamIO` interface.
   * Manages the interval timer, initial info, and tab-change listeners.
   *
   * @param {StreamIO} io
   * @returns {() => void} cleanup function
   */
  #runStreamLoop(io) {
    this.#assertAlive();

    // ── Shared mutable state for the tick callback ──────────────────────────
    /** @type {{ frameInFlight: boolean; consoleOffset: number; infoTick: number; infoEvery: number }} */
    const state = {
      frameInFlight: false,
      consoleOffset: 0,
      infoTick:      0,
      infoEvery:     Math.max(1, Math.ceil(2000 / (1000 / this.#streamConfig.fps))),
    };

    // ── Send initial info on connect ────────────────────────────────────────
    (async () => {
      const con = this.read(0);
      state.consoleOffset = con.offset;
      await this.#sendInfo(io, { consoleOutput: con.output });
    })();

    // ── Tab-change listener: immediately push updated tab list ──────────────
    const onTabsChanged = () => this.#sendInfo(io);
    this.#tabChangeListeners.add(onTabsChanged);

    // ── Periodic tick: frame + info ─────────────────────────────────────────
    const interval = Math.round(1000 / this.#streamConfig.fps);
    const tick     = () => this.#streamTick(io, state);
    this.#streamTimerId = setInterval(tick, interval);

    // ── IO close handler: stop the stream ───────────────────────────────────
    io.onClose(() => {
      if (this.#streamTimerId !== null) {
        clearInterval(this.#streamTimerId);
        this.#streamTimerId = null;
      }
      this.#tabChangeListeners.delete(onTabsChanged);
    });

    return () => {
      if (this.#streamTimerId !== null) {
        clearInterval(this.#streamTimerId);
        this.#streamTimerId = null;
      }
      this.#tabChangeListeners.delete(onTabsChanged);
    };
  }

  /**
   * Start streaming JPEG frames to a WebSocket client.
   *
   * Protocol (server → client):
   *   binary ArrayBuffer  — raw JPEG frame
   *   { type:'info', … } — page state, console, tab list
   *
   * Protocol (client → server):
   *   { type:'mousemove',  x, y }
   *   { type:'mousedown',  button, x, y }
   *   { type:'mouseup',    button, x, y }
   *   { type:'wheel',      deltaX, deltaY }
   *   { type:'keydown',    key, modifiers[] }
   *   { type:'keyup',      key }
   *   { type:'type',       text }
   *
   * @param {WebSocket} ws
   * @returns {() => void} cleanup — call to stop the stream
   */
  startStreaming(ws) {
    const WS_OPEN = 1;
    /** @type {StreamIO} */
    const io = {
      sendBinary: (buf) => { if (ws.readyState === WS_OPEN) ws.send(buf, { binary: true }); },
      sendJSON:   (obj)  => { if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(obj)); },
      isConnected: ()    => ws.readyState === WS_OPEN,
      onClose:    (cb)  => {
        ws.on('close', () => cb());
        ws.on('error', () => cb());
      },
      close:      ()    => { if (ws.readyState === WS_OPEN) ws.close(); },
    };
    return this.#runStreamLoop(io);
  }

  /**
   * Start streaming JPEG frames to an Electron renderer via `webContents.send()`.
   * Used by the IPC transport layer when running inside Electron.
   *
   * @param {WebContents} webContents
   * @returns {() => void} cleanup — call to stop the stream
   */
  startStreamingToWebContents(webContents) {
    /** @type {StreamIO} */
    const io = {
      sendBinary: (buf) => {
        if (!webContents.isDestroyed()) webContents.send('browser:stream:frame', buf);
      },
      sendJSON: (obj) => {
        if (!webContents.isDestroyed()) webContents.send('browser:stream:message', obj);
      },
      isConnected: () => !webContents.isDestroyed(),
      onClose:    (cb) => {
        webContents.on('destroyed', () => cb());
      },
      close: () => {
        if (!webContents.isDestroyed()) webContents.send('browser:stream:end');
      },
    };
    return this.#runStreamLoop(io);
  }

  /**
   * Start streaming to a generic StreamIO interface.
   * Used by the plugin streaming system where the transport layer
   * provides a StreamIO-based bridge instead of a raw WebSocket or
   * Electron WebContents.
   *
   * The `io` object must implement the StreamIO contract:
   *   sendBinary(buf) — push a JPEG frame
   *   sendJSON(obj)   — push a JSON control message (page info, console)
   *   isConnected()   — return true while the client is connected
   *   onClose(cb)     — register a callback when the connection drops
   *
   * @param {StreamIO} io
   * @returns {() => void} cleanup — call to stop the stream
   */
  startStreamingIO(io) {
    return this.#runStreamLoop(io);
  }

  /**
   * Dispatch a single input event from the streaming client to the Playwright page.
   * All coordinate values are normalised [0, 1] and scaled to the actual viewport.
   *
   * @param {{ type: string; [k: string]: unknown }} event
   * @returns {Promise<void>}
   */
  async dispatchInput(event) {
    if (!this.#alive || !this.#activePage) return;
    const p = this.#activePage;

    switch (event.type) {
      case 'mousemove': {
        const { x, y } = this.#toPixels(event.x, event.y);
        await p.mouse.move(x, y);
        break;
      }
      case 'mousedown': {
        const { x, y } = this.#toPixels(event.x, event.y);
        await p.mouse.move(x, y);
        await p.mouse.down({ button: this.#resolveButton(event.button) });
        break;
      }
      case 'mouseup': {
        const { x, y } = this.#toPixels(event.x, event.y);
        await p.mouse.move(x, y); // ensure cursor is at the release position so browser fires `click`
        await p.mouse.up({ button: this.#resolveButton(event.button) });
        break;
      }
      case 'wheel': {
        await p.mouse.wheel(Number(event.deltaX) || 0, Number(event.deltaY) || 0);
        break;
      }
      case 'keydown': {
        const key  = String(event.key);
        const mods = Array.isArray(event.modifiers) ? event.modifiers : [];
        for (const mod of mods) await p.keyboard.down(mod).catch(() => {});
        await p.keyboard.down(key).catch(() => {});
        break;
      }
      case 'keyup': {
        const key  = String(event.key);
        const mods = Array.isArray(event.modifiers) ? event.modifiers : [];
        await p.keyboard.up(key).catch(() => {});
        for (const mod of [...mods].reverse()) await p.keyboard.up(mod).catch(() => {});
        break;
      }
      case 'type': {
        await p.keyboard.type(String(event.text));
        break;
      }
      default:
        break;
    }
  }

  /** Convert normalised [0, 1] coordinates to Playwright viewport pixel coords. */
  #toPixels(nx, ny) {
    const vp = this.#activePage?.viewportSize() ?? { width: 1280, height: 720 };
    return {
      x: Math.round(Number(nx) * vp.width),
      y: Math.round(Number(ny) * vp.height),
    };
  }

  /** Map MouseEvent.button (0=left, 1=middle, 2=right) to Playwright's button string. */
  #resolveButton(btn) {
    if (btn === 1) return 'middle';
    if (btn === 2) return 'right';
    return 'left';
  }

  /**
   * Return text-only page state for the AI tool.
   * Intentionally does NOT include a screenshot — the AI reads text,
   * and the screenshot is served separately via the /screenshot endpoint.
   * @returns {Promise<{ url: string; title: string; consoleOutput: string; outputOffset: number }>}
   */
  async snapshot() {
    this.#assertAlive();
    const title  = await this.#activePage.title();
    const buf    = this.read(0);
    const tabs   = await this.#getTabListAsync();
    return {
      url:            this.#activePage.url(),
      title,
      consoleOutput:  buf.output,
      outputOffset:   buf.offset,
      tabs,
      activeTabIndex: this.#activeTabIndex,
    };
  }

  // ── Buffer ───────────────────────────────────────────────────────────────────

  /** @returns {{ buf: string; absOffset: number }} */
  #getActiveBuf() {
    const entry = this.#pageBufs.get(this.#activePage);
    return entry ?? { buf: '', absOffset: 0 };
  }

  /**
   * Read console log output since `fromOffset` for the active tab.
   * Pass 0 to read from the start of the retained buffer.
   * @param {number} [fromOffset]
   * @returns {{ output: string; offset: number }}
   */
  read(fromOffset = 0) {
    const entry     = this.#getActiveBuf();
    const bufStart  = entry.absOffset - entry.buf.length;
    const sliceFrom = Math.max(0, fromOffset - bufStart);
    return {
      output: entry.buf.slice(sliceFrom),
      offset: entry.absOffset,
    };
  }

  // ── Info ─────────────────────────────────────────────────────────────────────

  /** Serialisable summary of this session's current state. */
  info() {
    const vp = this.#activePage?.viewportSize();
    return {
      id:             this.#id,
      label:          this.#label,
      alive:          this.#alive,
      url:            this.#activePage?.url() ?? null,
      createdAt:      this.#createdAt,
      outputBytes:    this.#getActiveBuf().absOffset,
      viewport:       vp ?? this.#launchConfig.viewport ?? { width: 1280, height: 720 },
      useProxy:       this.#useProxy,
      activeTabIndex: this.#activeTabIndex,
      tabs:           this.#getTabList(),
      launchConfig:   { ...this.#launchConfig },
    };
  }

  /**
   * Query network requests recorded for this session.
   *
   * @param {Object} [opts]
   * @param {number}   [opts.tabIndex]        - Restrict to a single tab (0-based index). Omit for all tabs.
   * @param {number}   [opts.limit=100]       - Maximum entries to return. 0 = return all.
   * @param {number}   [opts.afterId]         - Cursor: only entries with id > afterId.
   * @param {string[]} [opts.resourceType]    - Filter by Playwright resource type.
   * @param {string}   [opts.urlPattern]      - Substring filter on URL.
   * @param {string[]} [opts.methodFilter]    - Filter by HTTP method.
   * @param {boolean}  [opts.includeHeaders=false] - Include request/response headers.
   * @param {boolean}  [opts.includeBody=false]    - Include request/response body text.
   * @param {number}   [opts.statusMin]       - Only entries with status >= statusMin.
   * @param {number}   [opts.statusMax]       - Only entries with status <= statusMax.
   * @param {boolean}  [opts.onlyFailed]      - Only network-failed requests.
   * @param {number}   [opts.minDurationMs]   - Only entries with duration >= minDurationMs.
   * @param {number}   [opts.maxDurationMs]   - Only entries with duration <= maxDurationMs.
   * @param {string}   [opts.bodyKeyword]     - Substring filter on request/response body.
   * @param {string}   [opts.headerKeyword]   - Substring filter on request/response header values.
   * @param {number}   [opts.bodyMaxBytes]    - Truncate returned body strings to this many bytes.
   * @returns {{ entries: NetworkEntry[]; totalCount: number; hasMore: boolean }}
   */
  getNetworkRequests({
    tabIndex,
    limit = 100,
    afterId,
    resourceType,
    urlPattern,
    methodFilter,
    includeHeaders = false,
    includeBody    = false,
    statusMin,
    statusMax,
    onlyFailed,
    minDurationMs,
    maxDurationMs,
    bodyKeyword,
    headerKeyword,
    bodyMaxBytes,
  } = {}) {
    this.#assertAlive();

    const queryOpts = {
      limit, afterId, resourceType, urlPattern, methodFilter,
      includeHeaders, includeBody,
      statusMin, statusMax, onlyFailed,
      minDurationMs, maxDurationMs,
      bodyKeyword, headerKeyword, bodyMaxBytes,
    };

    if (tabIndex !== undefined) {
      const page     = this.#pages[tabIndex];
      const recorder = page ? this.#networkRecorders.get(page) : undefined;
      if (!recorder) {
        return { entries: [], totalCount: 0, hasMore: false };
      }
      return recorder.query(queryOpts);
    }

    // ── All tabs: merge entries from every recorder ───────────────────────────
    const merged = [];
    for (const recorder of this.#networkRecorders.values()) {
      const { entries } = recorder.query({ ...queryOpts, limit: this.#maxEntriesPerRecorder() });
      merged.push(...entries);
    }
    merged.sort((a, b) => a.id - b.id);

    const totalCount = merged.length;
    const effectiveLimit = limit === 0 ? merged.length : limit;
    const hasMore    = merged.length > effectiveLimit;
    const slice      = limit === 0 ? merged : merged.slice(-effectiveLimit);
    return { entries: slice, totalCount, hasMore };
  }

  /**
   * Clear all recorded network entries for one tab or all tabs.
   *
   * @param {Object} [opts]
   * @param {number} [opts.tabIndex] - Clear only this tab (0-based). Omit to clear all tabs.
   */
  clearNetworkRequests({ tabIndex } = {}) {
    this.#assertAlive();
    if (tabIndex !== undefined) {
      const page     = this.#pages[tabIndex];
      const recorder = page ? this.#networkRecorders.get(page) : undefined;
      recorder?.clear();
    } else {
      for (const recorder of this.#networkRecorders.values()) {
        recorder.clear();
      }
    }
  }

  /** Upper bound for per-recorder queries when merging all tabs. */
  #maxEntriesPerRecorder() {
    return 1000;
  }

  get id()    { return this.#id; }
  get alive() { return this.#alive; }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** Append a line to the given page's ring buffer and trim if over capacity. */
  #appendLog(page, line) {
    const entry = this.#pageBufs.get(page);
    if (!entry) return;
    const text   = `${line}\n`;
    entry.buf       += text;
    entry.absOffset += text.length;
    if (entry.buf.length > this.#maxBuf) {
      entry.buf = entry.buf.slice(entry.buf.length - this.#maxBuf);
    }
  }

  #assertAlive() {
    if (!this.#alive) {
      throw new Error(`Browser session "${this.#id}" is not running`);
    }
  }
}
