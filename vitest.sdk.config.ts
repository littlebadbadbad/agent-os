import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-sdk': path.resolve(__dirname, './src'),
      '@agent-type': path.resolve(__dirname, './agent-type'),
      '@agent-UI': path.resolve(__dirname, './agent-UI')
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts', 'agent-UI/__tests__/**/*.test.ts', 'extensions/**/__tests__/**/*.test.ts'],
    exclude: ['extensions/browser/**'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'agent-UI/store/providerConfigStore.ts',
        'agent-UI/store/providerStore.ts',
        'agent-UI/api/providerConfigApi.ts',
        'agent-UI/api/backend.ts',
        'agent-UI/handlers/asyncHandler.ts',
        'agent-UI/handlers/streamHandler.ts',
      ],
      reportsDirectory: './coverage/sdk',
    },
  },
});
