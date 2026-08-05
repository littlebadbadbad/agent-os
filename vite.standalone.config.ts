import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

/**
 * Standalone build: UMD + IIFE formats with ALL dependencies bundled in
 * (including react, react-dom, zod).
 * Intended for direct browser usage via <script> tags.
 *
 * Run after the main lib build:
 *   vite build --config vite.standalone.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      '@agent-sdk': path.resolve(__dirname, './src'),
      '@agent-type': path.resolve(__dirname, './agent-type'),
      '@agent-UI': path.resolve(__dirname, './agent-UI'),
    },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'AgentSDK',
      formats: ['umd', 'iife'],
      fileName: (format) => `agent-sdk.${format}.js`,
    },
    target: ['chrome70', 'es2018'],
    rollupOptions: {
      // No externals — every dependency is inlined into the bundle.
    },
    sourcemap: true,
    // Do not wipe dist/ — the lib build (ES/CJS) has already written output there.
    emptyOutDir: false,
  },
  plugins: [react(), cssInjectedByJsPlugin()],
})
