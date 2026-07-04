import react from '@vitejs/plugin-react'
import path from 'path/win32';
import { defineConfig, loadEnv } from 'vite'

/**
 * Demo app build: outputs a standalone SPA into dist-demo/
 * This is served by the backend as static assets when packaged as an exe.
 *
 * Run: vite build --config vite.demo.config.ts
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.PORT ?? 3001;
  return {
    base: './',
    root: '.',
    build: {
      outDir: 'dist-demo',
      emptyOutDir: true,
      rollupOptions: {
        input: 'index.html',
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@agent-sdk': path.resolve(__dirname, './src'),
        '@agent-type': path.resolve(__dirname, './agent-type'),
        '@agent-UI': path.resolve(__dirname, './agent-UI'),
      },
    },
    // In dev mode, the demo uses the same entry as before
    server: {
      watch: {
        ignored: ['**/.electron-cache/**'],
      },
      port: 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          ws: true, // proxy WebSocket upgrades (for /api/browser/:id/stream)
        },
        // Plugin compiled files (activate.js, etc.) are served by the backend.
        '/plugins': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
})
