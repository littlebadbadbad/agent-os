/**
 * electron/main.ts — Electron main process entry point
 *
 * Compiled to dist-electron/main.mjs by scripts/compile-electron.mjs.
 *
 * Env vars are written BEFORE backend/server.cjs is required so that
 * backend/lib/paths.js (which runs at module-init time) picks up the correct
 * roots.  The three vars consumed by paths.js are:
 *
 *   UAP_EXE_DIR      – directory of the Electron exe (release/<version>/ when packaged,
 *                      project root when running in dev)
 *   UAP_IS_PACKAGED  – "1" when running as a packaged Electron app
 *   UAP_NATIVE_ROOT  – absolute path to the node_modules dir that holds the
 *                      rebuilt native bindings (better-sqlite3, node-pty, …)
 */

import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from 'electron';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// ── ESM compatibility shims ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// ── Environment setup (must happen before any backend import) ─────────────────
// app.getPath / app.isPackaged are available synchronously before whenReady().
if (app.isPackaged) {
  // Packaged mode: exe lives at release/<version>/agent-sdk.exe
  process.env.UAP_EXE_DIR = dirname(process.execPath);
  process.env.UAP_IS_PACKAGED = '1';
  // Native modules are in resources/app/node_modules/ (asar:false layout)
  process.env.UAP_NATIVE_ROOT = join(process.resourcesPath, 'app', 'node_modules');
} else {
  // Dev mode: dist-electron/main.mjs  →  project root is one level up
  process.env.UAP_EXE_DIR = join(__dirname, '..');
}

// ── Backend startup ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3001', 10);

async function loadBackend() {
  if (app.isPackaged) {
    return require('./server.cjs');
  }
  return import('../backend/index.js');
}

// ── Window management ─────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false, // reveal only after the page finishes loading (no white flash)
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs access to Node built-ins
    },
  });

  // Remove all default menus (File, Edit, View, …)
  Menu.setApplicationMenu(null);

  // F12 toggles the DevTools (convenience for debugging)
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Open external links in the system browser, not in a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the frontend via the backend's HTTP server for same-origin
  // dynamic imports (app agent entries, etc.) and fetch calls.
  // The backend starts before createWindow(), so the server is ready.
  // Dev mode connects to the Vite dev server for HMR.
  const frontendUrl = app.isPackaged
    ? `http://localhost:${PORT}`
    : (process.env.VITE_DEV_SERVER_URL ?? `http://localhost:5173`);
  mainWindow.loadURL(frontendUrl).catch((err: Error) => {
    const label = app.isPackaged ? 'loadURL (production)' : 'loadURL (dev)';
    console.error(`[electron] Failed to load app (${label}):`, err.message);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ── Session flush on window close ───────────────────────────────────────
  // The renderer fires beforeunload to flush sessions via IPC, but the
  // renderer process may be torn down before the async IPC completes.
  // This main-process handler requests a flush from the renderer and
  // waits for it before allowing the window to close.
  let flushCompleteResolver: (() => void) | null = null;

  ipcMain.handle('app:flushComplete', () => {
    if (flushCompleteResolver) {
      flushCompleteResolver();
      flushCompleteResolver = null;
    }
  });

  // ── Native dialog: open directory picker ─────────────────────────────
  // Used by the app manager's install-from-folder flow (appManagerApi).
  // Falls back to prompt() if this handler is absent (e.g. in non-Electron
  // environments).
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    return result;
  });

  mainWindow.on('close', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      event.preventDefault();
      // Ask the renderer to flush session persistence.
      mainWindow.webContents.send('app:requestFlush');

      const doClose = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
      };

      // Wait for renderer confirmation, with a 3 s fallback.
      const timeout = setTimeout(() => {
        flushCompleteResolver = null;
        doClose();
      }, 3000);

      flushCompleteResolver = () => {
        clearTimeout(timeout);
        doClose();
      };
    }
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    const backend = await loadBackend();

    await backend.startServer();
    await backend.registerIpcHandlers();
  } catch (err) {
    console.error('[electron] Backend startup failed:', err);
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── App-level flush guard ─────────────────────────────────────────────────
// When the app is quitting (not just a window close), request session flush
// from the renderer proactively.  This catches process-level shutdowns
// (e.g. Ctrl+C in gui-dev.mjs on Windows) where the window-level close
// event may not fire cleanly.
app.on('before-quit', (_event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('app:requestFlush');
    } catch {
      // Renderer may already be torn down — that's OK.
    }
  }
});
