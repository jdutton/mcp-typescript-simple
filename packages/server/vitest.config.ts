import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test file patterns
    include: ['**/*.test.ts'],

    // Exclude patterns
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },

    // Global APIs
    globals: true,

    // Timeout configuration
    testTimeout: 10000,

    // No custom reporters - keep it simple for packages
    reporters: ['default'],
  },
});
