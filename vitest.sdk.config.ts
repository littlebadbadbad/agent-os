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
    include: ['src/__tests__/**/*.test.ts', 'agent-type/__tests__/**/*.test.ts', 'agent-UI/__tests__/**/*.test.ts', 'agent-UI/__tests__/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
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
        'agent-type/*.ts',
        'agent-UI/config.ts',
        'agent-UI/env.ts',
        'agent-UI/createAdapters.ts',
        'agent-UI/agents.ts',
        'agent-UI/utils/index.ts',
        'agent-UI/api/*.ts',
        'agent-UI/store/*.ts',
        'agent-UI/transport/*.ts',
        'agent-UI/handlers/*.ts',
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
        'agent-type/ui-slot/**',
        'agent-type/electron-api.d.ts',
      ],
      reportsDirectory: './coverage/sdk',
    },
  },
});
