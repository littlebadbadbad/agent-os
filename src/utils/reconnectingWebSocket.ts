/**
 * src/utils/reconnectingWebSocket.ts — WebSocket with automatic reconnection
 *
 * Wraps a native WebSocket with exponential-backoff reconnection.
 * Returns a lightweight handle with `send()` / `close()` / `open()` methods
 * plus `readyState` and `connected` properties.
 *
 * Reconnection is only active while the consumer has NOT called `close()`.
 * Once intentionally closed, no further reconnect attempts are made.
 * The initial connection is deferred — open the socket with `open()`.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReconnectingWebSocketOptions {
  /** Maximum backoff interval in ms (default 30 000). */
  maxInterval?: number;
  /** Minimum backoff interval in ms (default 1000). */
  minInterval?: number;
  /** Called every time the underlying WS receives a message. */
  onMessage?: (data: string | ArrayBuffer | SharedArrayBuffer) => void;
  /** Called when the connection opens (including after reconnection). */
  onOpen?: () => void;
  /** Called when the connection closes (including before reconnection). */
  onClose?: (wasClean: boolean) => void;
  /** Called when a WebSocket error occurs. */
  onError?: (error: Event) => void;
}

export interface ReconnectingWebSocketHandle {
  /** Open the WebSocket connection. Starts reconnection loop on failure. */
  open(): void;
  /**
   * Intentionally close the WebSocket. No reconnection will be attempted.
   * @param code   WebSocket close code (default 1000).
   * @param reason Reason string (optional).
   */
  close(code?: number, reason?: string): void;
  /** Send data over the WebSocket. No-op if not connected. */
  send(data: string | Blob | BufferSource): void;
  /** Current underlying WebSocket readyState, or CLOSED if no socket. */
  readonly readyState: number;
  /** `true` when the underlying connection is open and data can flow. */
  readonly connected: boolean;
}

// ── ReconnectingWebSocket factory ──────────────────────────────────────────────

/**
 * Create a WebSocket handle with automatic exponential-backoff reconnection.
 *
 * @example
 * ```ts
 * const ws = createReconnectingWebSocket('ws://example.com', {
 *   onMessage: (data) => console.log(data),
 * });
 * ws.open();
 * ```
 */
export function createReconnectingWebSocket(
  url: string,
  opts: ReconnectingWebSocketOptions = {},
): ReconnectingWebSocketHandle {
  const binaryType: BinaryType = 'arraybuffer';

  const resolvedOpts: Required<ReconnectingWebSocketOptions> = {
    maxInterval: opts.maxInterval ?? 30_000,
    minInterval: opts.minInterval ?? 1000,
    onMessage:   opts.onMessage ?? (() => {}),
    onOpen:      opts.onOpen ?? (() => {}),
    onClose:     opts.onClose ?? (() => {}),
    onError:     opts.onError ?? (() => {}),
  };

  // ── Mutable state ─────────────────────────────────────────────────────────

  let ws: WebSocket | null = null;
  let intentionalClose = false;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let connected = false;

  // ── Internal helpers ──────────────────────────────────────────────────────

  function cancelRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function cleanup(): void {
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try { ws.close(); } catch { /* ignore */ }
      ws = null;
    }
  }

  function scheduleReconnect(): void {
    if (intentionalClose) return;
    cancelRetry();

    const delay = Math.min(
      resolvedOpts.minInterval * Math.pow(2, retryCount),
      resolvedOpts.maxInterval,
    );
    // Add jitter: ±25%
    const jitter = delay * (0.75 + Math.random() * 0.5);
    retryCount++;

    retryTimer = setTimeout(() => connect(), jitter);
  }

  function connect(): void {
    if (intentionalClose) return;
    cleanup();

    try {
      const socket = new WebSocket(url);
      socket.binaryType = binaryType;

      socket.onopen = () => {
        connected = true;
        retryCount = 0;
        ws = socket;
        resolvedOpts.onOpen();
      };

      socket.onmessage = (ev: MessageEvent) => {
        resolvedOpts.onMessage(ev.data);
      };

      socket.onclose = (ev: CloseEvent) => {
        connected = false;
        resolvedOpts.onClose(ev.wasClean);
        ws = null;
        scheduleReconnect();
      };

      socket.onerror = (ev: Event) => {
        resolvedOpts.onError(ev);
        // onclose will fire after onerror, triggering reconnection.
      };
    } catch {
      scheduleReconnect();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    open(): void {
      intentionalClose = false;
      connect();
    },

    close(code = 1000, reason?: string): void {
      intentionalClose = true;
      cancelRetry();
      ws?.close(code, reason);
      ws = null;
      connected = false;
    },

    send(data: string | Blob | BufferSource): void {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    },

    get readyState(): number {
      return ws?.readyState ?? WebSocket.CLOSED;
    },

    get connected(): boolean {
      return connected;
    },
  };
}
