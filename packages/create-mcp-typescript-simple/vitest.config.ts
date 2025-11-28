import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test timeouts (scaffolding validation is slow)
    testTimeout: 90000, // 90 seconds for scaffolding + npm install + validation
    hookTimeout: 30000, // 30 seconds for setup/teardown

    // Sequential execution (scaffolding creates temp dirs, safer to run one at a time)
    threads: false,
    isolate: true,

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    },

    // Output
    reporters: ['verbose'],
  },
});
