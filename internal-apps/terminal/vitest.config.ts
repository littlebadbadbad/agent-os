import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-type': path.resolve(__dirname, '../../agent-type'),
    },
  },
  test: {
    root: __dirname,
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.js'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
