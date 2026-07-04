import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import dts from 'vite-plugin-dts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.PORT ?? 3001;
  return {
  resolve: {
    alias: {
      '@agent-sdk': './src',
      '@agent-type': './agent-type',
      '@agent-UI': './agent-UI',
    },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'AgentSDK',
      // ES module (.js) and CommonJS (.cjs) — zod peer deps are externalized;
      // all other dependencies (react, react-dom, …) are bundled in.
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'agent-sdk.js' : 'agent-sdk.cjs'),
    },
    // Target Chrome 70 (ES2018); ensures syntax is also compatible with
    // older Node.js versions — no Node version restriction in the output.
    target: ['chrome70', 'es2018'],
    rollupOptions: {
      // Only zod peer-dep is kept external; everything else is bundled.
      external: ['zod'],
    },
    sourcemap: true,
  },
  plugins: [
    react(),
    cssInjectedByJsPlugin(),
    dts({
      include: ['src'],
      outDir: 'dist',
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${backendPort}`,
    },
  },
  };
})
