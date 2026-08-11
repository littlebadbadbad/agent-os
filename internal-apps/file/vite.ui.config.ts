/**
 * internal-apps/file/vite.ui.config.ts — Vite build config for file app UI
 *
 * Compiles ui/index.html + main.tsx into self-contained HTML+JS+CSS
 * under APP_OUT_DIR/ui/.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const outDir = process.env.APP_OUT_DIR
  ? resolve(process.env.APP_OUT_DIR, 'ui')
  : resolve(__dirname, '..', '..', 'apps', 'file', 'ui');

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
      generateScopedName: 'fui_[local]_[hash:base64:4]',
    },
  },
});
