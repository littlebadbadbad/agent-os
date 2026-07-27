import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const outDir = process.env.PLUGIN_UI_OUT_DIR
  ? resolve(process.env.PLUGIN_UI_OUT_DIR, 'ui')
  : resolve(__dirname, '..', '..', 'plugins', 'cron', 'ui');

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'ui'),
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@agent-type': resolve(__dirname, '..', '..', 'agent-type'),
    },
  },
});
