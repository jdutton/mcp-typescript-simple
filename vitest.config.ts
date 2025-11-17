import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@mcp-typescript-simple/example-mcp': resolve(__dirname, 'packages/example-mcp/src'),
    },
  },
  test: {
    // Test environment
    environment: 'node',

    // Set NODE_ENV for test detection
    env: {
      NODE_ENV: 'test',
    },

    // Test file patterns
    include: [
      '**/__tests__/**/*.test.ts',
      '**/*.test.ts'
    ],

    // Exclude patterns
    exclude: [
      '**/node_modules/**',
      '**/packages/example-mcp/test/system/**',        // System tests (run separately)
      '**/packages/example-mcp/test/contract/**',      // Contract tests (run separately against live servers)
      '**/packages/example-mcp/test/playwright/**',    // Playwright tests (run separately)
      '**/packages/create-mcp-typescript-simple/templates/**',  // Template files (not real tests)
      '**/packages/create-mcp-typescript-simple/test/scaffolding-validation.test.ts', // Scaffolding regression (run separately via workspace command)
      '**/build/**',
      '**/coverage/**',
      '**/packages/example-mcp/test/integration/deployment-validation.test.ts', // Custom test runner, not a Vitest test
      '**/packages/adapter-vercel/test/deployment-validation.test.ts', // Custom test runner, not a Vitest test
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'packages/*/src/**/*.ts',
      ],
      exclude: [
        'packages/**/src/**/*.d.ts',
        'packages/**/*.test.ts',
        'packages/**/*.test.js',
      ],
      // Coverage gates (L5 audit recommendation)
      // Prevents regression below current levels while allowing incremental improvement
      // Current coverage: ~38.6% lines/statements, 50% branches, 40% functions
      // Long-term goal: 70%+ across all metrics
      thresholds: {
        statements: 38,  // Set to current coverage (38.6%) to prevent regression
        branches: 55,    // Increase from 50% to improve branch coverage
        functions: 45,   // Increase from 40% to improve function coverage
        lines: 38,       // Set to current coverage (38.6%) to prevent regression
      },
    },

    // Silent mode - suppress console output during tests
    silent: true,

    // Global setup/teardown
    globals: true, // Enable global APIs like describe, it, expect

    // Jest compatibility - map jest to vi
    setupFiles: ['./test/framework/vitest-setup.ts'],

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
