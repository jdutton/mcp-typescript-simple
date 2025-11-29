import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'test/',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
    },
  },
  // Note: No path aliases needed - packages resolve from node_modules
  // Workspace-style aliases like '@mcp-typescript-simple/tools': '../tools/src'
  // only work in monorepo setups and break standalone project installations
});
