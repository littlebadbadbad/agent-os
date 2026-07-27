import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-type': path.resolve(__dirname, '../../agent-type'),
    },
  },
  test: {
    include: ['ui/components/__tests__/**/*.test.ts', 'ui/components/__tests__/**/*.test.tsx'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
