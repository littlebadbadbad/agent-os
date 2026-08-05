import {
  useEffect,
  useRef,
  useCallback,
  useState,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type {
  BrowserInputEvent,
  BrowserStreamMessage,
  BrowserStreamConnection,
  BrowserStreamCallbacks,
  BrowserTabInfo,
  StreamConfig,
} from '../agent/index';
import { toArrayBuffer } from '../agent/index';
import type { BrowserAdapter } from '../agent/index';
import { BrowserViewportResizer } from './BrowserViewportResizer';
import styles from './BrowserPanel.module.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrowserPageInfo {
  url: string | null;
  title: string | null;
  /** Full console buffer — sent once on connect or tab switch. */
  consoleOutput?: string;
  /** New console lines since last info message. */
  consoleAppend?: string;
  /** Current tab list — present whenever tabs change (from stream message). */
  tabs?: BrowserTabInfo[];
  /** Index of the active tab — present together with `tabs`. */
  activeTabIndex?: number;
}

export interface BrowserLiveViewProps {
  /** Whether the browser session is still alive. */
  alive: boolean;
  /**
   * Browser adapter whose `connectStream` method is called to establish
   * a live preview stream.  The transport (WebSocket, IPC, …) is fully
   * encapsulated — this component only consumes the abstract connection.
   */
  adapter: BrowserAdapter;
  /** Browser session id to stream. */
  browserId: string;
  /** Called when the server sends updated page URL / title / console lines. */
  onPageInfo?: (info: BrowserPageInfo) => void;
  /**
   * Initial stream configuration (FPS, quality).
   * Passed to `adapter.connectStream()` on mount.
   * Changes to this object are NOT automatically applied — use the returned
   * connection's `updateConfig()` method via `connRef`.
   */
  streamConfig?: StreamConfig;
  /** Current viewport dimensions (used by BrowserViewportResizer). */
  viewport?: { width: number; height: number };
  /** Called when the user drag-resizes the viewport. */
  onViewportResize?(width: number, height: number): void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BrowserLiveView({
  alive,
  adapter,
  browserId,
  onPageInfo,
  streamConfig,
  viewport,
  onViewportResize,
}: BrowserLiveViewProps): ReactElement {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const connRef    = useRef<BrowserStreamConnection | null>(null);
  const pendingRef = useRef(false); // frame decode in-flight — drop while busy
  const [connected, setConnected] = useState(false);

  // Stable ref to onPageInfo so the stream effect never needs to reconnect
  // when the callback identity changes.
  const onPageInfoRef = useRef(onPageInfo);
  onPageInfoRef.current = onPageInfo;

  // Stable ref to streamConfig so the effect reads fresh value each reconnect.
  const streamConfigRef = useRef(streamConfig);
  streamConfigRef.current = streamConfig;

  // ── Stream lifecycle ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!alive) return;

    const conn = adapter.connectStream(browserId, {
      onFrame(data) {
        if (pendingRef.current) return; // drop frame while still decoding
        pendingRef.current = true;
        (async () => {
          try {
            const frame = toArrayBuffer(data);
            if (!frame) return;
            const blob   = new Blob([frame], { type: 'image/jpeg' });
            const bitmap = await createImageBitmap(blob);
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== bitmap.width)   canvas.width  = bitmap.width;
              if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
              canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
            }
            bitmap.close();
          } catch { /* decode errors on rapid navigation */ } finally {
            pendingRef.current = false;
          }
        })();
      },
      onMessage(msg: BrowserStreamMessage) {
        if (msg.type === 'info') {
          onPageInfoRef.current?.({
            url:            msg.url,
            title:          msg.title,
            consoleOutput:  msg.consoleOutput,
            consoleAppend:  msg.consoleAppend,
            tabs:           msg.tabs,
            activeTabIndex: msg.activeTabIndex,
          });
        }
      },
      onStateChange(connected_) {
        setConnected(connected_);
      },
    }, streamConfigRef.current);

    connRef.current = conn;

    return () => {
      conn.close();
      connRef.current = null;
    };
  // onPageInfo omitted intentionally — see ref pattern above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alive, adapter, browserId]);

  // ── Input helpers ─────────────────────────────────────────────────────────

  const send = useCallback((event: BrowserInputEvent) => {
    connRef.current?.send(event);
  }, []);

  /** Normalise pointer position to [0, 1] relative to the canvas display rect. */
  const coords = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top)  / rect.height,
    };
  }, []);

  // ── Wheel event (must be non-passive to prevent[default]) ────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      send({ type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY });
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [send]);

  // ── Keyboard handlers ─────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { key, shiftKey, ctrlKey, altKey, metaKey } = e;

    // Printable characters with no control modifiers → type event.
    // This fires proper `input` events in the page, unlike raw keydown.
    if (key.length === 1 && !ctrlKey && !altKey && !metaKey) {
      send({ type: 'type', text: key });
      return;
    }

    // Special keys and modifier combos → keydown event.
    const modifiers: string[] = [];
    if (shiftKey && key !== 'Shift')   modifiers.push('Shift');
    if (ctrlKey  && key !== 'Control') modifiers.push('Control');
    if (altKey   && key !== 'Alt')     modifiers.push('Alt');
    if (metaKey  && key !== 'Meta')    modifiers.push('Meta');
    send({ type: 'keydown', key, modifiers });
  }, [send]);

  const handleKeyUp = useCallback((e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    // Only send keyup for keys that used keydown (not the printable-char type path).
    const { key, ctrlKey, altKey, metaKey } = e;
    if (key.length !== 1 || ctrlKey || altKey || metaKey) {
      send({ type: 'keyup', key });
    }
  }, [send]);

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    send({ type: 'mousemove', ...coords(e) });
  }, [send, coords]);

  const handleMouseDown = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.currentTarget.focus(); // ensure canvas receives keyboard events
    send({ type: 'mousedown', button: e.button, ...coords(e) });
  }, [send, coords]);

  const handleMouseUp = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    send({ type: 'mouseup', button: e.button, ...coords(e) });
  }, [send, coords]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!alive) {
    return (
      <div className={styles['live-view-placeholder']}>
        <span className={styles['screenshot-icon']}>🌐</span>
        <span>Browser session closed</span>
      </div>
    );
  }

  return (
    <div className={styles['live-view-area']}>
      {!connected && (
        <div className={styles['live-view-overlay']}>
          <span className={styles['live-view-connecting']}>Connecting…</span>
        </div>
      )}
      <div className={styles['live-view-canvas-wrap']}>
        <canvas
          ref={canvasRef}
          className={styles['live-view-canvas']}
          tabIndex={0}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onContextMenu={e => e.preventDefault()}
          onDragStart={e => e.preventDefault()}
          aria-label="Browser live view — click to focus, then type to interact"
        />
        {/* Dimension badge (shows current viewport size) */}
        {viewport && connected && (
          <div className={styles['vp-dim-badge']}>
            {viewport.width} × {viewport.height}
          </div>
        )}
        {/* Draggable resize handles */}
        {viewport && connected && onViewportResize && (
          <BrowserViewportResizer
            width={viewport.width}
            height={viewport.height}
            onResize={onViewportResize}
          />
        )}
      </div>
    </div>
  );
}
