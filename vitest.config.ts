import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@mcp-typescript-simple/example-mcp': resolve(__dirname, 'packages/example-mcp/src'),
    },
  },
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
      '**/packages/example-mcp/test/system/**',        // System tests (run separately)
      '**/packages/example-mcp/test/playwright/**',    // Playwright tests (run separately)
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
      thresholds: {
        statements: 30,
        branches: 50,
        functions: 40,
        lines: 30,
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
    // Use both default (for human-readable output) and LLM reporter (for agent-friendly format)
    reporters: ['default', './test/framework/llm-reporter.ts'],

    // Pool options for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
});
