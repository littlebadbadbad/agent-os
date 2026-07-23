/**
 * Agent SDK — Backend entry point
 *
 * Start: node backend/index.js  (set env vars in your shell or .env before starting)
 *
 * When imported from the Electron main process, use the exported startServer()
 * function instead of relying on the auto-start at the bottom of this file.
 */

import { createServer } from 'http';
import { URL } from 'url';
import { createReadStream, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { setCORS, send, readBody } from './lib/http.js';
import './lib/proxy.js';   // side-effect: initialises global dispatcher
import { createLogger } from './lib/logger.js';
import { STATIC_DIR, PLUGINS_DIR, DATA_ROOT, AGENT_DIR } from './lib/paths.js';
import { WebSocketServer } from 'ws';
import { pluginRouter } from './lib/plugin-router.js';
import { createPluginScanner } from './lib/plugin-scanner.js';
import { getProxyConfig } from './lib/proxy.js';
import { decryptPat, getPublicKeyPem } from './lib/rsa.js';
import { createPluginConfigStore } from './lib/plugin-config-store.js';
import { registerCorePlugins } from './core/index.js';
/**
 * Lazy IPC handler registration — only loaded when called from Electron main process.
 * Static re-export forces Node.js to resolve 'electron' imports on plain `node backend/index.js`,
 * which crashes because the 'electron' package is a native addon unavailable outside Electron.
 *
 * By using dynamic import(), the entire Electron IPC module tree is resolved lazily.
 * In the esbuild CJS bundle, import() is preserved as-is and works correctly because
 * actual Electron context is active when this function is called.
 */
export async function registerIpcHandlers() {
  const { registerIpcHandlers: fn } = await import('./transports/ipc/index.js');
  fn(pluginRouter);
}

const log = createLogger('server');

// ── Static frontend assets ──────────────────────────────────────────────────────────────
// When packaged as an exe, dist-demo/ lives next to the versioned executable.
// In dev mode this directory does not exist; Vite serves the frontend instead.

const SERVE_STATIC = existsSync(STATIC_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.map':   'application/json',
  '.ts':    'application/javascript',
  '.tsx':   'application/javascript',
};

function serveStatic(req, res, urlPath) {
  if (!SERVE_STATIC || req.method !== 'GET') return false;

  let relPath = decodeURIComponent(urlPath).replace(/^\//, '') || 'index.html';
  let filePath = join(STATIC_DIR, relPath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(STATIC_DIR, 'index.html');
  }
  if (!existsSync(filePath)) return false;

  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const stat = statSync(filePath);

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
  return true;
}

// ── Plugin static files ────────────────────────────────────────────────────────
// Serve compiled plugin files (agent entries, UI entries) from the plugins/
// directory so the browser can dynamically import them.

function servePluginFile(req, res, urlPath) {
  if (req.method !== 'GET') return false;

  // Only serve /plugins/ paths.
  if (!urlPath.startsWith('/plugins/')) return false;

  // Strip the leading /plugins/ prefix — PLUGINS_DIR already includes 'plugins'.
  // /plugins/browser/activate.js → browser/activate.js
  let relPath = decodeURIComponent(urlPath).replace(/^\/plugins\//, '');
  let filePath = join(PLUGINS_DIR, relPath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const stat = statSync(filePath);

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
  });
  createReadStream(filePath).pipe(res);
  return true;
}

// ── Constants ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3001;

// ── Request router ──────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const { pathname: path } = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // ── Plugin API routes (core + external) ────────────────────────────────
    // All API methods are registered via defineApi() by super built-in plugins
    // (system, proxy, models, sessions, plugin-manager, etc.) and regular plugins.
    // The plugin router matches POST /api/plugin/<pluginId>/<method>.
    const pluginMatch = pluginRouter.matchHttpRoute(path);
    if (pluginMatch !== false) {
      if (req.method !== 'POST') {
        return send(res, 405, { error: 'Plugin API endpoints require POST' });
      }
      const body = await readBody(req);
      const result = await pluginMatch.handler(body);
      return send(res, 200, result);
    }

    if (servePluginFile(req, res, path)) return;

    if (serveStatic(req, res, path)) return;

    log.warn(`<- 404  no route for ${req.method} ${path}`);
    send(res, 404, { error: `No route for ${req.method} ${path}` });
  } catch (err) {
    log.error('unhandled exception', err.message);
    send(res, 500, { error: err.message });
  }
}

// ── Start server ──────────────────────────────────────────────────────────────
// Exported so the Electron main process can await server readiness before
// showing the BrowserWindow. Auto-starts when run directly as a Node.js script.

export const pluginScanner = createPluginScanner(pluginRouter, PLUGINS_DIR, DATA_ROOT, {
  proxy: getProxyConfig,
  rsaDecrypt: () => decryptPat,
  rsaPublicKey: getPublicKeyPem,
}, AGENT_DIR);

export const pluginConfigStore = createPluginConfigStore(DATA_ROOT);

export async function startServer() {
  // Register super built-in plugins (system, proxy, models, sessions,
  // plugin-manager, etc.) BEFORE scanning external plugins so their
  // APIs are available to both HTTP and IPC transports immediately.
  registerCorePlugins(pluginRouter, { pluginScanner, pluginConfigStore });

  // Bootstrap external plugins before starting the HTTP server (R7).
  await pluginScanner.bootstrap();

  // ── WebSocket server (noServer — piggybacks on the HTTP server) ────────────
  const wss = new WebSocketServer({ noServer: true });

  const server = createServer(handleRequest);

  server.on('error', (err) => {
    log.error(`Server error: ${err.message}`);
    process.exit(1);
  });

  server.on('upgrade', (req, socket, head) => {
    // ── Plugin stream upgrade ──────────────────────────────────────────────
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pluginMatch = pluginRouter.matchWsPath(url.pathname);
    if (pluginMatch !== false) {
      // Extract connect-time params from URL query string.
      const params = Object.fromEntries(url.searchParams.entries());

      wss.handleUpgrade(req, socket, head, (ws) => {
        const WS_OPEN = 1;

        // Build StreamIO first, then pass to handler — no temporal coupling.
        const io = {
          sendBinary: (buf) => {
            if (ws.readyState === WS_OPEN) ws.send(buf, { binary: true });
          },
          sendJSON: (obj) => {
            if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(obj));
          },
          isConnected: () => ws.readyState === WS_OPEN,
          onClose: (cb) => { ws.on('close', cb); },
        };

        const connection = pluginMatch.handler(params, io);

        // Bridge: WebSocket message → plugin onClientMessage
        ws.on('message', (data) => {
          if (!connection.onClientMessage) return;
          let msg;
          try { msg = JSON.parse(data.toString()); } catch { return; }
          connection.onClientMessage(msg);
        });

        const sub = connection.subscribe();
        ws.on('close', () => sub.unsubscribe());
        ws.on('error', () => sub.unsubscribe());
      });
      return;
    }

    // Reject unknown upgrade targets cleanly.
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  });

  await new Promise((resolve) => {
    server.listen(PORT, () => {
      log.info(`Agent backend listening on http://localhost:${PORT}`);
      if (SERVE_STATIC) {
        log.info(`Serving frontend from ${STATIC_DIR}`);
      }
      resolve(undefined);
    });
  });
}

// Auto-start only when run directly as a Node.js script (not imported from Electron).
const _isMain = !process.versions.electron
if (_isMain) {
  startServer();
}
