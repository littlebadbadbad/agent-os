import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-type': path.resolve(__dirname, '../../agent-type'),
    },
  },
  test: {
    include: ['agent/__tests__/**/*.test.ts', 'backend/__tests__/**/*.test.js', 'ui/__tests__/**/*.test.ts', 'ui/__tests__/**/*.test.tsx'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
