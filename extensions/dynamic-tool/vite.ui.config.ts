/**
 * extensions/dynamic-tool/vite.ui.config.ts — Vite build config for dynamic-tool UI
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const outDir = process.env.PLUGIN_OUT_DIR
  ? resolve(process.env.PLUGIN_OUT_DIR, 'ui')
  : resolve(__dirname, '..', '..', 'plugins', 'dynamic-tool', 'ui');

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
      localsConvention: 'camelCase',
      generateScopedName: 'dtui_[local]_[hash:base64:4]',
    },
  },
});
