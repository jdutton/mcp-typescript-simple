import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test file patterns - ALL integration tests across all packages
    include: [
      '**/packages/*/test/integration/**/*.test.ts',
      '**/packages/*/test/integration/**/*.integration.test.ts',
    ],

    // Exclude patterns
    exclude: [
      '**/node_modules/**',
      '**/build/**',
      '**/coverage/**',
      '**/deployment-validation.test.ts', // Custom test runner script, not a Vitest test
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage/integration',
      include: [
        'packages/*/src/**/*.ts',
      ],
      exclude: [
        'packages/*/src/**/*.d.ts',
      ],
    },

    // Integration tests may take longer than unit tests
    testTimeout: 30000,

    // Run integration tests sequentially to avoid conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run in single process to avoid conflicts
      },
    },

    // Enable globals for Vitest
    globals: true,

    // Clear and restore mocks between tests
    clearMocks: true,
    restoreMocks: true,

    // Reporters
    reporters: ['default'],
  },
});
