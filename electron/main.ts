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

import { app, BrowserWindow, Menu, shell } from 'electron';
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

/**
 * Load the backend module.
 *
 * ── Production (packaged): the backend is pre-bundled as CJS at
 *    dist-electron/server.cjs, loaded via require().
 * ── Development: the backend source is loaded directly via dynamic
 *    import() so that changes to backend/index.js are visible without
 *    a separate bundling step.  The esbuild build in compile-electron.mjs
 *    excludes '../backend/index.js' from the bundle so this import()
 *    resolves to the real file-system module at runtime.
 */
async function loadBackend() {
  if (app.isPackaged) {
    return require('./server.cjs');
  }
  // In dev mode: directly import the ESM source so changes to backend/
  // are picked up without a bundling step. The esbuild bundle in
  // compile-electron.mjs excludes this path, preserving the real
  // filesystem module resolution at runtime.
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

  if (app.isPackaged) {
    // Production: load pre-built static assets via file:// protocol.
    // The backend HTTP server also serves the same assets at
    // http://localhost:<PORT> for browser access.
    const indexPath = join(__dirname, 'dist-demo', 'index.html');
    mainWindow.loadFile(indexPath).catch((err: Error) => {
      console.error('[electron] Failed to load app (loadFile):', err.message);
    });
  } else {
    // Development: connect to the Vite dev server for HMR.
    const frontendUrl = process.env.VITE_DEV_SERVER_URL ?? `http://localhost:5173`;
    mainWindow.loadURL(frontendUrl).catch((err: Error) => {
      console.error('[electron] Failed to load app (loadURL):', err.message);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
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
