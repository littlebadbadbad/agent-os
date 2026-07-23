import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['agent-type/__tests__/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
