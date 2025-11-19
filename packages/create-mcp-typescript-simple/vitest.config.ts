import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test timeouts (scaffolding validation is slow)
    testTimeout: 300000, // 5 minutes for full scaffolding + validation
    hookTimeout: 60000, // 1 minute for setup/teardown

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
