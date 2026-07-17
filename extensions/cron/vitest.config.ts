import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-type': path.resolve(__dirname, '../../agent-type'),
    },
  },
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'agent/*.ts',
        'backend/cron-manager/*.js',
      ],
      reportsDirectory: './coverage',
    },
  },
});
