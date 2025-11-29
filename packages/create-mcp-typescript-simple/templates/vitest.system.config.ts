import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test file patterns - only system tests
    include: [
      'test/system/**/*.test.ts'
    ],

    // Port configuration note:
    // System tests use BASE_PORT defined in test/system/utils.ts
    // Default is 3000 (configured during project scaffolding)
    // If port 3000 conflicts with other services, you can:
    //   1. Edit BASE_PORT in test/system/utils.ts
    //   2. Use environment variable: HTTP_TEST_PORT=3010 npm run test:system
    // The framework includes self-healing port management that automatically
    // cleans up leaked processes from previous test runs.

    // Exclude patterns
    exclude: [
      '**/node_modules/**',
      '**/build/**',
      '**/dist/**',
      '**/coverage/**',
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage/system',
      include: [
        'src/**/*.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
      ],
    },

    // System tests may take longer than unit tests
    testTimeout: 30000,

    // System tests should run sequentially to avoid conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run in single process to avoid port conflicts
      },
    },

    // Global setup and teardown for HTTP server management
    globalSetup: ['./test/system/vitest-global-setup.ts'],
    globalTeardown: ['./test/system/vitest-global-teardown.ts'],

    // Enable globals for Vitest
    globals: true,

    // Clear and restore mocks between tests
    clearMocks: true,
    restoreMocks: true,

    // Reporters
    reporters: ['default'],
  },
});
