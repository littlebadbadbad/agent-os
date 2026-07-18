import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['__tests__/backend/**/*.test.js'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
