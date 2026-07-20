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
    include: ['src/__tests__/**/*.test.ts', 'agent-UI/__tests__/**/*.test.ts', 'extensions/**/__tests__/**/*.test.ts', 'extensions/**/__tests__/**/*.test.tsx'],
    exclude: ['extensions/browser/**'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'src/tools/**/*.ts',
        'src/client/**/*.ts',
        'src/utils/**/*.ts',
      ],
      exclude: [
        'src/tools/index.ts',
        'src/tools/types/index.ts',
        'src/tools/types/response.ts',

        'src/tools/dynamicTool/**',
        'src/tools/experience/**',
        'src/tools/file/**',
        'src/tools/git/**',
        'src/tools/messages/**',
        'src/tools/subagent/index.ts',
        'src/tools/subagent/registryInternal.ts',
        'src/tools/subagent/registryTypes.ts',
        'src/tools/subagent/types.ts',
        'src/client/index.ts',
        'src/client/types.ts',
        'src/client/agentSession.types.ts',
        'src/client/sessionManager.types.ts',
      ],
      reportsDirectory: './coverage/sdk',
    },
  },
});
