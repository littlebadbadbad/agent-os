/**
 * internal-apps/devops/vite.ui.config.ts
 *
 * Vite build config for the devops app's UI entry.
 *
 * - Input:  ui/index.html
 * - Output: ${APP_OUT_DIR}/ui/  (self-contained HTML + JS + CSS)
 * - Target: es2022
 * - React JSX via @vitejs/plugin-react
 * - SCSS modules compiled to injected CSS
 * - @agent-type alias resolves to the workspace's agent-type/ directory
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const outDir = process.env.APP_OUT_DIR
  ? resolve(process.env.APP_OUT_DIR, 'ui')
  : resolve(__dirname, '..', '..', 'apps', 'devops', 'ui');

export default defineConfig({
  root: resolve(__dirname, 'ui'),
  base: './',
  resolve: {
    alias: {
      '@agent-type': resolve(__dirname, '..', '..', 'agent-type', 'index.ts'),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, 'ui', 'index.html'),
    },
  },
  plugins: [react()],
  css: {
    modules: {
      generateScopedName: '[name]__[local]___[hash:base64:5]',
    },
  },
});
