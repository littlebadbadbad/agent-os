import type { ToolSet } from "./toolset";
import type { AgentSessionState, SessionStateLike, AppStateExtension, Tool, Attachment } from "./core";
import type { SlotDeclaration, SlotContext, SlotHostMessage } from "./ui-slot";
import type { ModelMeta } from "./model";
import type { AppBridge } from "./app-bridge";
import type { AppServiceRegistry } from "./app-services";

// ═══════════════════════════════════════════════════════════════════════════════
//  App manifest & lifecycle types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A single configuration property definition.
 * Simplified version of VS Code's `contributes.configuration` property schema.
 *
 * The discriminated union ensures that `default` is typed to match `type`.
 */
export type ConfigProperty =
  | {
      readonly type: 'string';
      readonly default?: string;
      readonly description?: string;
      /** Enum of allowed values. */
      readonly enum?: readonly string[];
    }
  | {
      readonly type: 'number';
      readonly default?: number;
      readonly description?: string;
    }
  | {
      readonly type: 'boolean';
      readonly default?: boolean;
      readonly description?: string;
    }
  | {
      readonly type: 'array' | 'object';
      readonly default?: unknown;
      readonly description?: string;
    };

/**
 * App configuration schema — declares what config the app accepts.
 * Analogous to VS Code's `contributes.configuration`.
 */
export interface AppConfiguration {
  /** Property definitions keyed by dot-separated path (e.g. "browser.viewport.width"). */
  readonly properties: Readonly<Record<string, ConfigProperty>>;
  /** Property keys that are required (must have a value or default). */
  readonly required?: readonly string[];
}

/**
 * App manifest — describes a app's identity and entry points.
 *
 * Analogous to VS Code's `package.json` contributes section.
 * Each app has a `manifest.json` that conforms to this interface.
 *
 * A app can expose up to three entry points:
 * - `agentEntry` — runs inside the agent sandbox, can register ToolSets
 * - `backendEntry` — runs on the backend (Node.js process), can register
 *   API endpoints and streams
 * - `uiEntry` — runs in the frontend (browser), can render custom UI
 *   components
 *
 * @example
 * ```json
 * {
 *   "id": "browser",
 *   "name": "Browser Automation",
 *   "version": "0.1.0",
 *   "configuration": {
 *     "properties": {
 *       "browser.viewport.width": { "type": "number", "default": 1280 }
 *     }
 *   }
 * }
 * ```
 */
export interface AppManifest {
  /** Unique app identifier (kebab-case). Used for routing, file paths, and IPC channels. */
  readonly id: string;
  /** Human-readable display name shown in the UI. */
  readonly name: string;
  /** SemVer version string. */
  readonly version: string;
  /** Human-readable description. */
  readonly description?: string;
  /**
   * Relative path to the agent-side entry point (runs in sandbox).
   * The module is expected to export an `activate` function.
   */
  readonly agentEntry?: string;
  /**
   * Relative path to the backend entry point (runs on server).
   * The module is expected to export an `activate` function.
   */
  readonly backendEntry?: string;
  /**
   * Path to the UI entry point (runs in browser iframe).
   * Can be a relative path (served from /agent-apps/<id>/<path>) or an
   * absolute URL (http://, https://, or protocol-relative //).
   * The module is expected to export an `activate` function.
   */
  readonly uiEntry?: string;
  /**
   * Configuration schema for this app.
   * Declares the configuration properties the app accepts,
   * their types, defaults, and descriptions.
   */
  readonly configuration?: AppConfiguration;
}

// ── App state ──────────────────────────────────────────────────────────────

/**
 * Runtime state of a single app instance.
 */
export type AppState =
  | "inactive"
  | "activating"
  | "active"
  | "error"
  | "disabled";

// ── App method ─────────────────────────────────────────────────────────────

/**
 * A callable endpoint exposed by a backend app.
 */
export type AppMethod = (
  params: Record<string, unknown>,
) => Promise<unknown>;

// ── Shared configuration types ──────────────────────────────────────────────

/**
 * Proxy configuration — shared between backend and apps.
 *
 * Backend creates it via `backend/lib/proxy.js` and exposes it to apps
 * through `BackendAppHost.getBackendConfig('proxy')`.  Apps must NOT
 * import backend modules directly.
 */
export interface ProxyConfig {
  /** Proxy protocol: http, https, socks5, or socks4. */
  readonly protocol: "http" | "https" | "socks5" | "socks4";
  /** Proxy hostname or IP. */
  readonly host: string;
  /** Proxy port (1–65535). */
  readonly port: number;
  /** Optional username for authenticated proxies. */
  readonly username: string;
  /** Optional password for authenticated proxies. */
  readonly password: string;
  /** Comma-separated exclude list (bypass proxy for these hosts). */
  readonly noProxy: string;
  /** Connection timeout in milliseconds. */
  readonly connectTimeout: number;
}

// ── Logger interface ──────────────────────────────────────────────────────────

/**
 * Structured logger with colour-coded output and 5 levels.
 *
 * Apps obtain a logger via `BackendAppHost.logger`.
 */
export interface Logger {
  info(msg: string, extras?: unknown): void;
  ok(msg: string, extras?: unknown): void;
  warn(msg: string, extras?: unknown): void;
  error(msg: string, extras?: unknown): void;
  debug(msg: string, extras?: unknown): void;
}

// ── App host interfaces ────────────────────────────────────────────────────

/**
 * Host interface injected into a backend app's activation scope.
 *
 * Backend apps use this to register API endpoints and streaming
 * capabilities that the frontend can consume via `AppApiClient`.
 * The host also provides access to a app-scoped data directory.
 */
export interface BackendAppHost {
  /**
   * Register an API method that the frontend can call via `apiClient.call`.
   *
   * @param method  Unique method name (namespaced per app).
   * @param handler Async handler invoked when the frontend calls this method.
   */
  defineApi(method: string, handler: AppMethod): void;

  /**
   * Register a streaming endpoint that the frontend can connect to
   * via `apiClient.connectStream`.
   *
   * @param name    Unique stream name (namespaced per app).
   * @param handler Factory that creates a `StreamConnection` for each client.
   */
  defineStream(name: string, handler: StreamHandler): void;

  /**
   * Absolute path to a writable directory scoped to this app.
   * The directory is created when the app is activated and persists
   * across restarts.
   */
  getAppDataDir(): string;

  /**
   * Absolute path to the `.agent/` directory for the current project.
   *
   * Apps use this to access per-project state files.
   *
   * @returns The `.agent/` directory path, or `null` if not available.
   */
  getAgentDir(): string | null;

  /**
   * Access a backend system configuration value by key.
   *
   * This replaces direct imports of backend modules with a controlled
   * interface, keeping apps decoupled from the core.
   *
   * Supported keys (varies by backend implementation):
   *   - `'proxy'` — current proxy configuration (returns {@link ProxyConfig})
   *
   * @param key  Configuration key name.
   * @returns    The configuration value.
   */
  getBackendConfig<T = unknown>(key: string): T;

  /**
   * Structured logger scoped to this app.
   *
   * Created lazily on first access — the namespace is automatically set to
   * the app's manifest `id`.  Subsequent reads return the cached instance.
   *
   * Replaces direct imports of `backend/lib/logger.js`.
   *
   * @example
   * ```ts
   * host.logger.info('activated');
   * ```
   */
  readonly logger: Logger;

  /**
   * Shared inter-app service registry.
   *
   * Internal (built-in) apps register service implementations here
   * during activation so that other backend apps can resolve and
   * call them directly — without going through the agent layer or
   * HTTP/IPC transport.
   *
   * @example
   * ```ts
   * // Terminal backend registers:
   * host.services.register('terminal', { createTerminalSession, ... });
   *
   * // MCP backend resolves:
   * const terminal = host.services.resolve('terminal');
   * ```
   */
  readonly services: AppServiceRegistry;
}

/**
 * Host interface injected into an agent-side app's activation scope.
 *
 * @typeParam TBridge  App-defined shared bridge object type.
 *                     Defaults to {@link AppBridge} (empty interface).
 *                     Extend via module augmentation or generic parameter.
 *
 * Agent apps can register ToolSets to extend the agent with custom
 * tools and lifecycle hooks, and interact with the agent runtime.
 */
export interface AgentAppHost<TBridge extends AppBridge = AppBridge> {
  /**
   * Register a ToolSet and its associated slot declarations on the agent.
   * Slots are stored independently from the session state so they can be
   * discovered even without an active session (e.g. toolButton slots).
   * Returns an unregister function.
   */
  registerToolSet(toolSet: ToolSet, slots?: readonly SlotDeclaration[]): () => void;

  /**
   * Shared bridge object — agent and UI layers hold the same reference.
   * Agent writes methods/properties; UI reads/calls them.
   * No serialisation, no string-based routing — direct property access.
   */
  readonly bridge: TBridge;

  /**
   * All ToolSets currently registered on the agent.
   */
  getRegisteredToolSets(): readonly ToolSet[];

  /**
   * All master tools (unfiltered) registered on the agent.
   */
  getTools(): readonly Tool[];

  /**
   * The agent's name/identifier.
   */
  readonly agentName: string;

  /**
   * Pre-bound API client for calling this app's backend API.
   * The app id is already bound at construction time —
   * callers do NOT pass appId.
   */
  readonly apiClient: AppApiClient;

  /**
   * Read a configuration value for this app.
   * Supports dot-separated deep access, e.g. `host.getConfig('browser.viewport.width')`.
   * Returns the property's default value if not explicitly set.
   */
  getConfig<T = unknown>(key: string): T;

  /**
   * Subscribe to configuration changes.
   * Returns an unsubscribe function.
   */
  onConfigChanged(cb: (config: Record<string, unknown>) => void): () => void;

  /**
   * This app's unique identifier (kebab-case).
   * Matches `manifest.id`.
   */
  readonly appId: string;

  /**
   * This app's display name (human-readable).
   * Matches `manifest.name`.
   */
  readonly appName: string;

  /**
   * This app's version (SemVer).
   * Matches `manifest.version`.
   */
  readonly appVersion: string;

  /**
   * Returns metadata for the currently selected model.
   *
   * Apps use this to configure their behaviour based on the active
   * model's context window — without depending on the UI layer's
   * provider store.
   */
  getSelectedModel(): ModelMeta;
}

// ── Slot session (minimal read surface for slot renderers) ────────────────────

/**
 * Minimal session interface consumed by slot renderers.
 *
 * Both {@link AgentSession} and {@link SubAgentConversation} satisfy this
 * interface — it captures only the two methods that renderers need:
 *   - `getState()` — read the current state snapshot
 *   - `subscribe()` — react to state changes
 *
 * Extracting this interface lets `createUiAppHost` and all slot
 * renderers work with **either** a main-agent session **or** a sub-agent
 * conversation, without depending on the full `AgentSession` type
 * (which carries `sendMessage`, `cancelMessage`, etc. — capabilities
 * that sub-agent conversations don't have and slot renderers don't need).
 *
 * The state type is {@link AgentSessionState}. `SubAgentConversationState`
 * is structurally compatible because it has `id`, `isLoading`, and the
 * same `[key: symbol]` index signature for app state slices.
 */
export interface SlotSession {
  /** Returns the current state snapshot. */
  getState(): SessionStateLike;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

export interface UiAppHost<TState extends AppStateExtension = AppStateExtension, TBridge extends AppBridge = AppBridge> {
  /**
   * API client for calling backend app methods.
   */
  readonly apiClient: AppApiClient;

  /** This app's unique identifier (kebab-case). */
  readonly appId: string;

  /** This app's display name (human-readable). */
  readonly appName: string;

  /** This app's version (SemVer). */
  readonly appVersion: string;

  /**
   * Shared bridge object — same reference as {@link AgentAppHost.bridge}.
   * Agent writes methods/properties; UI reads/calls them.
   */
  readonly bridge: TBridge;

  /**
   * Read the current session state and the ToolSet-specific state slice
   * for the ToolSet that owns this slot.
   *
   * Returns a 2-tuple: `[SessionStateLike, TState]`.
   */
  getAppState(): [SessionStateLike, TState] | undefined;

  /**
   * Returns the current slot context so the app UI knows which
   * slot it's rendering and can conditionally render the right component.
   */
  getSlotContext(): SlotContext;

  /**
   * Subscribe to messages from the host to the iframe.
   *
   * This is the ONLY way app UI code receives messages from the host.
   * It abstracts away `window.addEventListener('message')` — the host
   * handles version validation and routing internally.
   *
   * Messages received before the subscription is registered are buffered
   * by the host and replayed on first subscription, so the app UI
   * never misses the initial slot data (e.g. `toolCallInfo`).
   *
   * Returns an unsubscribe function.
   */
  onSlotMessage(cb: (msg: SlotHostMessage) => void): () => void;

  /**
   * Read a configuration value for this app.
   * Supports dot-separated deep access.
   * Returns the property's default value if not explicitly set.
   */
  getConfig<T = unknown>(key: string): T;

  /**
   * Subscribe to configuration changes.
   * Returns an unsubscribe function.
   */
  onConfigChanged(cb: (config: Record<string, unknown>) => void): () => void;
}

/**
 * Internal extension of {@link UiAppHost} used by the host-side
 * slot renderers. This method is NOT part of the public app API —
 * it exists so the renderer can push messages to the iframe without
 * the app UI touching any transport API.
 *
 * The host injects a `UiAppHostInternal` into the iframe, but app
 * UI code only sees the {@link UiAppHost} surface (the internal
 * method is prefixed with `_` to signal "private").
 */
export interface UiAppHostInternal<TState extends AppStateExtension = AppStateExtension, TBridge extends AppBridge = AppBridge> extends UiAppHost<TState, TBridge> {
  /**
   * Push a host→iframe message. Called by the slot renderer when it
   * has data for the app UI (e.g. toolCallInfo, state update).
   *
   * If the iframe has not yet registered any `onSlotMessage` subscriber,
   * the message is buffered and replayed when the first subscriber
   * registers. This eliminates the race condition where the host
   * sends data before the iframe's module script has booted.
   */
  _pushToIframe(msg: SlotHostMessage): void;
}

// ── UI app message protocol (legacy, kept only for backward-compat type refs) ─

/**
 * Legacy message protocol for iframe ↔ host communication.
 * No longer used by the slot-based system — kept only because
 * it's part of the public API surface exported from agent-type/index.ts.
 */
export type AppRecieveMessage =
  | { readonly type: "stateUpdate"; readonly payload: AgentSessionState }
  | { readonly type: "toolCallInfo"; readonly payload: ToolCallInfo };
// ── Tool card rendering (dual-mode) ───────────────────────────────────────────

/**
 * Status of a tool call, used by tool card rendering.
 */
export type ToolCallStatus = "running" | "done" | "error";

/**
 * View-model describing a single tool call for card rendering.
 *
 * Moved from `agent-UI` to `@agent-type` so that app tool-card
 * renderers (defined in `agent-type`) can reference it without
 * depending on host UI internals.
 *
 * @typeParam TResult — The tool's result type.  Defaults to `unknown`
 * for host-side storage and transport.  Each app narrows this to
 * its own per-tool result union (e.g. `PlanToolResult`) at the UI
 * boundary for type-safe field access without `as` casts.
 */
export interface ToolCallInfo<TResult = unknown> {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly status: ToolCallStatus;
  /** Serialised result shown in the bubble after execution completes. */
  readonly result?: TResult;
  readonly error?: string;
  /** Binary/image attachments produced by the tool (e.g. screenshots). */
  readonly attachments?: Attachment[];
}

/**
 * Template-mode descriptor: the app returns this structured object
 * and the host renders a standard tool card from it.
 *
 * This avoids the app needing to render its own DOM — the host
 * provides a consistent card layout.
 */
export interface ToolCardDescriptor {
  /** Icon/emoji shown in the card header. */
  readonly icon: string;
  /** Title shown in the card header. */
  readonly title: string;
  /** Execution status badge. */
  readonly status?: ToolCallStatus;
  /** Labelled key-value fields rendered in the card body. */
  readonly fields?: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
  }>;
  /** Optional image preview (e.g. screenshot). */
  readonly preview?: {
    readonly kind: "image";
    readonly src: string;
    readonly alt?: string;
  };
  /** Plain-text result shown after execution. */
  readonly resultText?: string;
  /** Error text shown when status is `'error'`. */
  readonly errorText?: string;
}

/**
 * Context passed to a custom-DOM-mode tool card renderer.
 * The app receives a container element and renders its own UI into it.
 */
export interface ToolCardRenderContext {
  /** DOM element the app should render into. */
  readonly container: HTMLElement;
  /** The tool call information to render. */
  readonly toolCallInfo: ToolCallInfo;
}

// ── Stream types ──────────────────────────────────────────────────────────────

/**
 * Factory that creates a `StreamConnection` for each client that connects
 * to a app's streaming endpoint.
 *
 * The transport layer constructs the `StreamIO` from its specific context
 * (WebSocket or Electron IPC) and passes it as the second argument.
 * The app captures `io` in the closure of `subscribe()` — no temporal
 * coupling, no field-mutation-after-creation.
 *
 * @param params  Optional connect-time parameters sent by the client at
 *                connection time. For example, the browser app passes
 *                `{ id: 'b1', config: { fps: 24 } }` to identify the
 *                browser session and initial stream config.
 * @param io      Transport-provided I/O interface for pushing data to
 *                the connected client. Created and passed by the transport
 *                layer at call time — the app captures it in its
 *                `subscribe()` closure.
 */
export type StreamHandler = (
  params: Record<string, unknown> | undefined,
  io: StreamIO,
) => StreamConnection;

/**
 * A bidirectional streaming connection created by a backend app.
 *
 * The `io` interface is injected as a parameter to `StreamHandler` and
 * captured in the `subscribe()` closure — there is no `io` field on this
 * object, so no "create then mutate" pattern is needed.
 *
 * For bidirectional streaming (e.g. browser live view), the app can
 * set `onClientMessage` to receive messages from the connected client
 * (like mouse/keyboard input events or config updates).
 */
export type StreamConnection = {
  /**
   * Optional handler for messages FROM the client TO the app.
   * Set by the app's stream implementation when bidirectional
   * communication is needed (e.g. browser input events, config
   * updates).  The transport layer calls this when the client sends
   * a message.
   */
  onClientMessage?: (data: unknown) => void;
  /** Start the streaming loop. The app pushes data via io (captured in closure). */
  subscribe: () => StreamSubscription;
};

/**
 * Consumer-facing stream client returned by {@link AppApiClient.connectStream}.
 *
 * The consumer sets callbacks to receive data pushed from the backend app,
 * then calls `subscribe()` to start the stream.  Data is received exclusively
 * through `callbacks` — no `io` or transport details leak to the consumer.
 */
export type AppStreamClient = {
  /** Callbacks for receiving data pushed from the backend app. */
  readonly callbacks: {
    onData: (chunk: unknown) => void;
    onEnd: () => void;
    onError: (error: Error) => void;
  };
  /**
   * Subscribe to start receiving data.  Call AFTER setting callbacks.
   * Returns a subscription for lifecycle management.
   */
  subscribe: () => StreamSubscription;
};

/**
 * Lifecycle handle for an active streaming connection.
 * The host calls `unsubscribe` when the client disconnects or the app
 * is deactivated.
 */
export type StreamSubscription = {
  /** Clean up resources when the connection ends. */
  unsubscribe: () => void;
};

/**
 * Transport-agnostic I/O interface for streaming data.
 *
 * The transport layer (IPC or WebSocket) creates a StreamIO from its
 * specific context (Electron WebContents or WS object) and injects it
 * as the second parameter to `StreamHandler` — the app captures it
 * in the closure and passes it to its streaming engine
 * (e.g. BrowserInstance#startStreamingIO).
 *
 * This interface is NOT part of `StreamConnection` — it is a parameter
 * of `StreamHandler`, ensuring zero temporal coupling.
 */
export type StreamIO = {
  /** Push a binary data chunk (typically a JPEG frame) to the client. */
  sendBinary: (buf: Uint8Array | ArrayBuffer) => void;
  /** Push a JSON-serializable control message to the client. */
  sendJSON: (obj: unknown) => void;
  /** Return true while the client connection is alive. */
  isConnected: () => boolean;
  /** Register a callback for when the client disconnects. */
  onClose: (cb: () => void) => void;
  /**
   * Signal end-of-stream and tear down the underlying transport.
   *
   * Call this AFTER the final `sendJSON` / `sendBinary` call to notify the
   * client that no more data will arrive.  The transport closes the WebSocket
   * connection (HTTP mode) or sends an `:end` IPC event (Electron mode),
   * which triggers the client's `onEnd` callback and closes the ReadableStream.
   *
   * Every stream handler MUST call `close()` after its logical completion
   * (success or terminal error) — otherwise the client's ReadableStream
   * hangs indefinitely waiting for data that will never arrive, locking up
   * the entire agent loop.
   */
  close: () => void;
};

// ── API client ────────────────────────────────────────────────────────────────

/**
 * Options for creating a AppApiClient.
 * Enables dependency injection for testing (R4).
 */
export interface AppApiClientOptions {
  /**
   * Custom invoke function for request-response calls.
   * When provided, replaces the default fetch/electronAPI.invoke logic.
   * Signature: (channel: string, params: unknown) => Promise<unknown>
   */
  invoke?: (channel: string, params: unknown) => Promise<unknown>;

  /**
   * Custom event subscription function for streams.
   * When provided, replaces the default IPC event listener logic.
   * Signature: (channel: string, callback: (data: unknown) => void) => () => void
   * Returns an unsubscribe function.
   */
  on?: (channel: string, callback: (data: unknown) => void) => () => void;
}

/**
 * Client interface for communicating with a backend app.
 *
 * Instances are pre-bound to a specific app at construction time
 * (via `createAppApiClient(appId, ...)`), so callers never
 * need to pass `appId`.
 *
 * Injected into both `AgentAppHost.apiClient` and `UiAppHost.apiClient`.
 * The implementation routes calls via HTTP or IPC depending on the runtime.
 */
export interface AppApiClient {
  /**
   * Call a backend app's API method.
   *
   * @param method  Method name registered via `BackendAppHost.defineApi`.
   * @param params  Parameters to pass to the method handler.
   * @returns       The value returned by the backend handler.
   */
  call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;

  /**
   * Connect to a backend app's streaming endpoint.
   *
   * Establishes a bidirectional streaming connection.  The transport
   * layer (HTTP/WS or Electron IPC) is fully encapsulated.
   *
   * @param streamName  Stream endpoint name registered via
   *                    `BackendAppHost.defineStream`.
   * @param params      Optional connect-time parameters forwarded to the
   *                    backend app's stream handler (e.g. browser session
   *                    id and initial config).
   * @returns  A `AppStreamClient` for receiving data and managing
   *           the stream lifecycle.  Set `callbacks.onData/onEnd/onError`
   *           before calling `subscribe()`.
   */
  connectStream(
    streamName: string,
    params?: Record<string, unknown>,
  ): AppStreamClient;
}

// ── Activated app ─────────────────────────────────────────────────────────

/**
 * State of a fully activated backend app.
 * Contains the app's manifest and any exposed methods/streams.
 */
export interface ActivatedBackendApp {
  /** The app's parsed manifest. */
  readonly manifest: AppManifest;
  /** Registered API methods (keyed by method name). */
  readonly methods: ReadonlyMap<string, AppMethod>;
  /** Registered streaming handlers (keyed by method name). */
  readonly streams: ReadonlyMap<string, StreamHandler>;
  /** Absolute path to the app's data directory. */
  readonly dataDir: string;
}

// ── Activation function signature ─────────────────────────────────────────────

/**
 * Standard app activation function signature.
 *
 * Every app entry point (`agentEntry`, `backendEntry`, `uiEntry`)
 * must export an `activate` function conforming to this signature.
 * The host calls it when the app is loaded.
 *
 * @example
 * ```ts
 * // agent/index.ts
 * import type { AgentAppHost } from '@agent-type';
 * export function activate(host: AgentAppHost) {
 *   host.registerToolSet(myToolSet);
 * }
 * ```
 */
export type AppActivateFunction<THost> = (
  host: THost,
) => void | Promise<void>;
