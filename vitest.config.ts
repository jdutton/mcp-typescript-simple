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
        statements: 70,
        branches: 55,
        functions: 65,
        lines: 70,
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
    reporters: ['default'],

    // Pool options for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
});
