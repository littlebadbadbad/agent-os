import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-type': path.resolve(__dirname, '../../agent-type'),
    },
  },
  test: {
    include: ['__tests__/agent/**/*.test.ts', '__tests__/backend/**/*.test.js'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
