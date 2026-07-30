import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agent-type': path.resolve(__dirname, '../../agent-type'),
    },
  },
  test: {
    root: __dirname,
    include: ['agent/__tests__/**/*.test.ts', 'backend/__tests__/**/*.test.js'],
    testTimeout: 15000,
    environment: 'node',
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'agent/**/*.ts',
        'backend/**/*.js',
      ],
      exclude: [
        'agent/index.ts',
        'agent/activate.ts',
        'agent/protocol/**',
        'agent/prompt.ts',
        'agent/__tests__/**',
        'backend/__tests__/**',
        'backend/index.js',
        'ui/**',
        '**/node_modules/**',
      ],
    },
  },
});
