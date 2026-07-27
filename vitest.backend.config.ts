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
    include: ['backend/__tests__/**/*.test.js'],
    environment: 'node',
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['backend/**/*.js'],
      exclude: [
        'backend/index.js',
        'backend/lib/format-converters/**',  // format converters tested via core tests
        'backend/__tests__/**',
      ],
      reportsDirectory: './coverage/backend',
    },
  },
});
