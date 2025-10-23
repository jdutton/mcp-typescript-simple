import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test file patterns
    include: [
      '**/__tests__/**/*.test.ts',
      '**/*.test.ts'
    ],

    // Exclude patterns
    exclude: [
      '**/node_modules/**',
      '**/test/system/**',
      '**/test/playwright/**',
      '**/build/**',
      '**/coverage/**',
      '**/test/integration/deployment-validation.test.ts', // Custom test runner, not a Vitest test (legacy path)
      '**/packages/adapter-vercel/test/deployment-validation.test.ts', // Custom test runner, not a Vitest test
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/**/*.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        // Exclude route handlers from unit test coverage - they are integration points
        // that require HTTP request/response testing via integration tests.
        // Testing routes via mocked unit tests is fragile and provides little value.
        // See test/integration/*-routes.test.ts for comprehensive route testing.
        'src/server/routes/**/*.ts',
      ],
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 45,
        lines: 65,
      },
    },

    // Silent mode - suppress console output during tests
    silent: true,

    // Global setup/teardown
    globals: true, // Enable global APIs like describe, it, expect

    // Jest compatibility - map jest to vi
    setupFiles: ['./test/vitest-setup.ts'],

    // Timeout configuration
    testTimeout: 10000,

    // Retry configuration
    retry: 0,

    // Reporters
    // Use both default (for human-readable output) and LLM reporter (for agent-friendly format)
    reporters: ['default', './test/llm-reporter.ts'],

    // Pool options for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
});
