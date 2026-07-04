import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-sdk': path.resolve(__dirname, './src/index.ts'),
      '@agent-type': path.resolve(__dirname, './agent-type/index.ts'),
      '@agent-UI': path.resolve(__dirname, './agent-UI/index.ts'),
    },
  },
  test: {
    include: [
      'backend/__tests__/**/*.test.js',
      'demo/**/__tests__/**/*.test.ts',
      'demo/**/__tests__/**/*.test.tsx',
    ],
    environment: 'node',
    setupFiles: ['demo/components/workItems/__tests__/setup.ts'],
    reporters: ['verbose'],
  },
});
