import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['**/packages/example-mcp/test/contract/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/build/**'],
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,

    // Global setup and teardown for HTTP server management (reuse system test setup)
    globalSetup: ['./packages/example-mcp/test/system/vitest-global-setup.ts'],
    globalTeardown: ['./packages/example-mcp/test/system/vitest-global-teardown.ts'],

    // Setup files for test utilities
    setupFiles: ['./test/framework/vitest-setup.ts'],

    // Contract tests should run sequentially to avoid conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run in single process to avoid port conflicts
      },
    },

    // Clear and restore mocks between tests
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@mcp-typescript-simple/config': resolve(__dirname, './packages/config/src'),
      '@mcp-typescript-simple/observability': resolve(__dirname, './packages/observability/src'),
      '@mcp-typescript-simple/auth': resolve(__dirname, './packages/auth/src'),
      '@mcp-typescript-simple/server': resolve(__dirname, './packages/server/src'),
      '@mcp-typescript-simple/http-server': resolve(__dirname, './packages/http-server/src'),
      '@mcp-typescript-simple/adapter-vercel': resolve(__dirname, './packages/adapter-vercel/src'),
      '@mcp-typescript-simple/tools': resolve(__dirname, './packages/tools/src'),
      '@mcp-typescript-simple/llm': resolve(__dirname, './packages/llm/src'),
      '@mcp-typescript-simple/session': resolve(__dirname, './packages/session/src'),
      '@mcp-typescript-simple/persistence': resolve(__dirname, './packages/persistence/src'),
    },
  },
});
