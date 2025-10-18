import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test file patterns - only system tests
    include: [
      '**/test/system/**/*.test.ts'
    ],

    // Exclude patterns
    exclude: [
      '**/node_modules/**',
      '**/build/**',
      '**/coverage/**',
      '**/test/system/**/*headless*', // Exclude Playwright tests (run via 'playwright test')
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

    // System test specific setup (test utilities only, no server management)
    setupFiles: ['./test/vitest-setup.ts', './test/system/setup.ts'],

    // Enable globals for Vitest
    globals: true,

    // Clear and restore mocks between tests
    clearMocks: true,
    restoreMocks: true,

    // Reporters - use LLM reporter for concise output
    reporters: [['./test/llm-reporter.ts', {}]],
  },
});
